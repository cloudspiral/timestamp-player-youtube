import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadRuntime() {
  const [cacheSource, discoveryCacheSource, timestampsSource, selectionSource] = await Promise.all([
    readFile(new URL("../src/lru-cache.js", import.meta.url), "utf8"),
    readFile(new URL("../src/discovery-cache.js", import.meta.url), "utf8"),
    readFile(new URL("../src/timestamps.js", import.meta.url), "utf8"),
    readFile(new URL("../src/track-selection.js", import.meta.url), "utf8"),
  ]);
  const context = vm.createContext({});
  vm.runInContext(cacheSource, context);
  vm.runInContext(timestampsSource, context);
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

test("runtime wiring bounds title retention and never stores raw fetched-comment records", async () => {
  const [contentSource, fetchedSource, trackDiscoverySource, manifest, packageJson, sessionSource] = await Promise.all([
    readFile(new URL("../src/content.js", import.meta.url), "utf8"),
    readFile(new URL("../src/fetched-comment-sources.js", import.meta.url), "utf8"),
    readFile(new URL("../src/track-discovery.js", import.meta.url), "utf8"),
    readFile(new URL("../manifest.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../src/watch-session.js", import.meta.url), "utf8"),
  ]);
  const scripts = manifest.content_scripts[0].js;
  const contentIndex = scripts.indexOf("src/content.js");

  assert.ok(scripts.indexOf("src/lru-cache.js") < scripts.indexOf("src/discovery-cache.js"));
  assert.ok(scripts.indexOf("src/track-selection.js") < scripts.indexOf("src/discovery-cache.js"));
  assert.ok(scripts.indexOf("src/discovery-cache.js") < contentIndex);
  assert.equal(
    packageJson.scripts["test:discovery-cache"],
    "node --test tests/discovery-cache.test.mjs"
  );

  assert.match(contentSource, /trackTitleCache: createTrackTitleCache\(\)/);
  assert.match(contentSource, /storeSettledTrackTitles\(state\.trackTitleCache, selectedResult\)/);
  assert.match(trackDiscoverySource, /mergeFetchedCommentSeeds\(/);
  assert.match(trackDiscoverySource, /selectFetchedCommentSource\(/);
  assert.doesNotMatch(trackDiscoverySource, /retainFetchedCommentResult\(/);
  assert.doesNotMatch(fetchedSource, /authorChannelId|authorName/);
  assert.doesNotMatch(fetchedSource, /text:\s*(?:record|String)/);
  assert.doesNotMatch(trackDiscoverySource, /discovery\.records/);
  assert.doesNotMatch(
    sessionSource,
    /commentDiscovery:\s*\{[\s\S]*?\brecords\s*:/,
    "watch sessions must not retain raw fetched-comment bodies"
  );
});
