import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadRuntime() {
  const [cacheSource, discoveryCacheSource, selectionSource] = await Promise.all([
    readFile(new URL("../src/lru-cache.js", import.meta.url), "utf8"),
    readFile(new URL("../src/discovery-cache.js", import.meta.url), "utf8"),
    readFile(new URL("../src/track-selection.js", import.meta.url), "utf8"),
  ]);
  const context = vm.createContext({});
  vm.runInContext(cacheSource, context);
  vm.runInContext(selectionSource, context);
  vm.runInContext(discoveryCacheSource, context);
  return {
    cache: context.TimestampPlayerDiscoveryCache,
    selection: context.TimestampPlayerTrackSelection,
  };
}

function result(selection, {
  generation = 1,
  sourceId = "comment-a",
  sourceScore = 10,
  starts = [0, 60, 120],
  status = selection.TRACK_SOURCE_STATUSES.PROVISIONAL,
  titles = [],
  videoId = "album",
} = {}) {
  return selection.createTrackSourceResult({
    channel: "comment-api",
    duration: 180,
    generation,
    kind: selection.TRACK_SOURCE_KINDS.COMMENT,
    ownership: {
      confidence: selection.OWNERSHIP_CONFIDENCE.STRONG,
      confirmed: true,
      evidence: "network-request",
    },
    sourceId,
    sourceScore,
    status,
    tracks: starts.map((start, index) => ({
      end: starts[index + 1] ?? 180,
      start,
      title: titles[index] || "",
    })),
    videoId,
  });
}

test("uses a 20-entry two-hour cache and absolute expiration", async () => {
  const { cache, selection } = await loadRuntime();
  let currentTime = 0;
  const titleCache = cache.createTrackTitleCache({ now: () => currentTime });

  assert.equal(cache.TRACK_TITLE_CACHE_MAX_ENTRIES, 20);
  assert.equal(cache.TRACK_TITLE_CACHE_TTL_MS, 2 * 60 * 60 * 1000);
  for (let index = 0; index < 21; index += 1) {
    const settled = result(selection, {
      sourceId: `comment-${index}`,
      status: selection.TRACK_SOURCE_STATUSES.SETTLED,
      videoId: `video-${index}`,
    });
    assert.equal(cache.storeSettledTrackTitles(titleCache, settled), true);
  }

  assert.equal(titleCache.size, 20);
  assert.equal(titleCache.has("video-0"), false);
  assert.equal(titleCache.has("video-20"), true);

  currentTime = cache.TRACK_TITLE_CACHE_TTL_MS;
  assert.equal(titleCache.has("video-20"), false);
  assert.equal(titleCache.size, 0);
});

test("only settled normalized title data is eligible for cross-video caching", async () => {
  const { cache, selection } = await loadRuntime();
  const titleCache = cache.createTrackTitleCache();
  const provisional = result(selection, { titles: ["One", "Two", "Three"] });

  assert.equal(cache.storeSettledTrackTitles(titleCache, provisional), false);
  assert.equal(titleCache.size, 0);

  const settled = { ...provisional, status: selection.TRACK_SOURCE_STATUSES.SETTLED };
  assert.equal(cache.storeSettledTrackTitles(titleCache, settled), true);
  const entry = titleCache.get("album");
  assert.deepEqual(Object.keys(entry).sort(), ["source", "tracks", "videoId"]);
  assert.equal("generation" in entry, false);
  assert.equal("ownership" in entry, false);
  assert.equal("status" in entry, false);

  const live = result(selection, { sourceId: "live", titles: [] });
  const enriched = selection.enrichTrackSourceFromCache(live, entry);
  assert.deepEqual(enriched.tracks.map(({ title }) => title), ["One", "Two", "Three"]);

  const weakerProvisional = result(selection, { titles: ["Worse", "Worse", "Worse"] });
  assert.equal(cache.storeSettledTrackTitles(titleCache, weakerProvisional), false);
  assert.deepEqual(
    titleCache.get("album").tracks.map(({ title }) => title),
    ["One", "Two", "Three"],
    "provisional observations cannot overwrite settled cached titles"
  );
});

test("an empty or worse retry preserves the normalized best result and can settle it", async () => {
  const { cache, selection } = await loadRuntime();
  const previous = result(selection, {
    sourceId: "best",
    sourceScore: 50,
    titles: ["One", "Two", "Three"],
  });
  const worse = result(selection, {
    sourceId: "worse",
    sourceScore: 10,
    titles: ["Worse one", "Worse two", "Worse three"],
  });

  const retained = cache.retainFetchedCommentResult(
    previous,
    worse,
    selection.TRACK_SOURCE_STATUSES.PROVISIONAL
  );
  assert.equal(retained.source.id, "best");
  assert.equal(retained.status, selection.TRACK_SOURCE_STATUSES.PROVISIONAL);

  const settled = cache.retainFetchedCommentResult(
    retained,
    null,
    selection.TRACK_SOURCE_STATUSES.SETTLED
  );
  assert.equal(settled.source.id, "best");
  assert.equal(settled.status, selection.TRACK_SOURCE_STATUSES.SETTLED);
  assert.equal(cache.retainFetchedCommentResult(null, null), null);
});

test("a stronger retry wins while exact-start title enrichment is monotonic", async () => {
  const { cache, selection } = await loadRuntime();
  const previous = result(selection, {
    sourceId: "previous",
    sourceScore: 10,
    titles: ["Detailed opening", "", "Finale"],
  });
  const stronger = result(selection, {
    sourceId: "stronger",
    sourceScore: 80,
    titles: ["", "Middle", "Finale"],
  });

  const retained = cache.retainFetchedCommentResult(
    previous,
    stronger,
    selection.TRACK_SOURCE_STATUSES.SETTLED
  );
  assert.equal(retained.source.id, "stronger");
  assert.equal(retained.status, selection.TRACK_SOURCE_STATUSES.SETTLED);
  assert.deepEqual(
    retained.tracks.map(({ title }) => title),
    ["Detailed opening", "Middle", "Finale"]
  );
});

test("equal scores remain stable across distinct comments but allow one source to improve", async () => {
  const { cache, selection } = await loadRuntime();
  const first = result(selection, {
    sourceId: "stable",
    sourceScore: 25,
    starts: [0, 90],
    titles: ["Opening", "Finale"],
  });
  const distinct = result(selection, {
    sourceId: "distinct",
    sourceScore: 25,
    starts: [0, 60, 120],
    titles: ["Different", "Comment", "Run"],
  });
  assert.equal(
    cache.retainFetchedCommentResult(first, distinct).source.id,
    "stable",
    "equal-scored comments retain the incumbent"
  );

  const expanded = result(selection, {
    sourceId: "stable",
    sourceScore: 25,
    starts: [0, 60, 120],
    titles: ["Opening", "Middle", "Finale"],
  });
  const improved = cache.retainFetchedCommentResult(first, expanded);
  assert.equal(improved.source.id, "stable");
  assert.equal(improved.tracks.length, 3);
});

test("runtime wiring bounds title retention and never stores raw fetched-comment records", async () => {
  const [contentSource, manifest, packageJson, sessionSource] = await Promise.all([
    readFile(new URL("../src/content.js", import.meta.url), "utf8"),
    readFile(new URL("../manifest.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../src/watch-session.js", import.meta.url), "utf8"),
  ]);
  const scripts = manifest.content_scripts[0].js;
  const contentIndex = scripts.indexOf("src/content.js");

  assert.ok(scripts.indexOf("src/lru-cache.js") < scripts.indexOf("src/discovery-cache.js"));
  assert.ok(scripts.indexOf("src/track-selection.js") < scripts.indexOf("src/discovery-cache.js"));
  assert.ok(scripts.indexOf("src/discovery-cache.js") < contentIndex);
  assert.match(packageJson.scripts["check:js"], /src\/lru-cache\.js/);
  assert.match(packageJson.scripts["check:js"], /src\/discovery-cache\.js/);
  assert.equal(
    packageJson.scripts["test:discovery-cache"],
    "node --test tests/discovery-cache.test.mjs"
  );

  assert.match(contentSource, /trackTitleCache: createTrackTitleCache\(\)/);
  assert.match(contentSource, /storeSettledTrackTitles\(state\.trackTitleCache, selectedResult\)/);
  assert.match(contentSource, /retainFetchedCommentResult\(/);
  assert.doesNotMatch(contentSource, /discovery\.records/);
  assert.doesNotMatch(
    sessionSource,
    /commentDiscovery:\s*\{[\s\S]*?\brecords\s*:/,
    "watch sessions must not retain raw fetched-comment bodies"
  );
});
