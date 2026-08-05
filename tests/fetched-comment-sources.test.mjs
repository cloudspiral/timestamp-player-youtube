import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadRuntime() {
  const [timestamps, selection, source] = await Promise.all([
    readFile(new URL("../src/timestamps.js", import.meta.url), "utf8"),
    readFile(new URL("../src/track-selection.js", import.meta.url), "utf8"),
    readFile(new URL("../src/fetched-comment-sources.js", import.meta.url), "utf8"),
  ]);
  const scoreCalls = [];
  const context = vm.createContext({
    TimestampPlayerCommentScoring: {
      COMMENT_SOURCE_TYPES: Object.freeze({
        PINNED: "pinned",
        REGULAR: "regular",
        UPLOADER: "uploader",
      }),
      scoreCommentTrackSource(input) {
        scoreCalls.push(input);
        return input.tracks.length * 100 + (input.sourceType === "pinned" ? 50 : 0);
      },
    },
  });
  vm.runInContext(timestamps, context);
  vm.runInContext(selection, context);
  vm.runInContext(source, context);
  return {
    api: context.TimestampPlayerFetchedCommentSources,
    scoreCalls,
    selection: context.TimestampPlayerTrackSelection,
  };
}

function comment(overrides = {}) {
  return {
    authorChannelId: "private-channel-id",
    authorName: "Private author",
    commentId: "comment-1",
    isPinned: false,
    isUploader: false,
    likeCount: 3,
    order: 0,
    text: "0:00 Opening\n0:30 Middle\n1:00 Finale\n2:00 Encore",
    ...overrides,
  };
}

test("compacts fetched records into bounded timestamp metadata without raw bodies or authors", async () => {
  const { api } = await loadRuntime();
  const seeds = api.createFetchedCommentSeeds([comment()]);

  assert.equal(seeds.length, 1);
  assert.equal(Object.isFrozen(seeds), true);
  assert.equal(Object.isFrozen(seeds[0]), true);
  assert.equal(Object.isFrozen(seeds[0].candidateVariants), true);
  assert.equal(Object.isFrozen(seeds[0].candidateVariants[0]), true);
  assert.deepEqual(Object.keys(seeds[0]).sort(), [
    "candidateVariants",
    "likeCount",
    "order",
    "sourceId",
    "sourceType",
  ]);
  assert.deepEqual(Object.keys(seeds[0].candidateVariants[0][0]).sort(), [
    "lineKey",
    "start",
    "title",
  ]);
  const serialized = JSON.stringify(seeds);
  assert.doesNotMatch(serialized, /Private author|private-channel-id/);
  assert.doesNotMatch(serialized, /0:00 Opening\\n0:30 Middle/);
  assert.equal(seeds[0].candidateVariants[0].length, 4);
});

test("bounds retained identifiers and titles and rejects invalid like metadata", async () => {
  const { api } = await loadRuntime();
  const longTitle = "T".repeat(api.MAX_FETCHED_TITLE_LENGTH + 100);
  const seeds = api.createFetchedCommentSeeds([comment({
    commentId: "c".repeat(api.MAX_FETCHED_SOURCE_ID_LENGTH + 50),
    likeCount: -4,
    text: `0:00 ${longTitle}\n0:30 Middle\n1:00 Finale`,
  })]);

  assert.equal(seeds[0].sourceId.length, api.MAX_FETCHED_SOURCE_ID_LENGTH);
  assert.equal(
    seeds[0].candidateVariants[0][0].title.length,
    api.MAX_FETCHED_TITLE_LENGTH
  );
  assert.equal(seeds[0].likeCount, null);
});

test("recomputes fetched-only tracks and scoring when duration grows or shrinks", async () => {
  const { api, scoreCalls, selection } = await loadRuntime();
  const seeds = api.createFetchedCommentSeeds([comment({ isPinned: true })]);
  const common = {
    generation: 2,
    observation: 4,
    seeds,
    status: selection.TRACK_SOURCE_STATUSES.SETTLED,
    videoId: "album",
  };

  const short = api.selectFetchedCommentSource({ ...common, duration: 90 });
  assert.equal(short.tracks.length, 3);
  assert.equal(short.tracks.at(-1).end, 90);
  assert.equal(short.sourceScore, 350);

  const grown = api.selectFetchedCommentSource({ ...common, duration: 150 });
  assert.equal(grown.tracks.length, 4);
  assert.equal(grown.tracks.at(-1).start, 120);
  assert.equal(grown.tracks.at(-1).end, 150);
  assert.equal(grown.sourceScore, 450);

  const tooShort = api.selectFetchedCommentSource({ ...common, duration: 50 });
  assert.equal(tooShort, null);
  assert.deepEqual(scoreCalls.map(({ duration }) => duration), [90, 150]);
});

test("merges retries by stable source while preserving richer candidates and metadata", async () => {
  const { api } = await loadRuntime();
  const previous = api.createFetchedCommentSeeds([comment({
    isUploader: true,
    likeCount: 4,
    text: "0:00 Opening\n0:30 Middle\n1:00 Finale",
  })]);
  const incoming = api.createFetchedCommentSeeds([comment({
    isPinned: true,
    likeCount: 10,
    order: 2,
    text: "0:00\n0:30 Hydrated middle\n1:00 Finale\n2:00 Encore",
  })]);

  const merged = api.mergeFetchedCommentSeeds(previous, incoming);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].sourceType, "pinned");
  assert.equal(merged[0].likeCount, 10);
  assert.equal(merged[0].order, 0);
  assert.equal(merged[0].candidateVariants.length, 2);
  assert.equal(merged[0].candidateVariants[0].length, 3);
  assert.equal(merged[0].candidateVariants[1].length, 4);
  assert.equal(merged[0].candidateVariants[0][0].title, "Opening");
  assert.equal(merged[0].candidateVariants[1][1].title, "Hydrated middle");
});

test("retains stable distinct-source order and ignores records without a viable candidate seed", async () => {
  const { api } = await loadRuntime();
  const first = api.createFetchedCommentSeeds([
    comment({ commentId: "first" }),
    comment({ commentId: "too-short", text: "0:00 One\n0:30 Two" }),
  ]);
  const second = api.createFetchedCommentSeeds([
    comment({ commentId: "second", order: 1 }),
    comment({ commentId: "first", likeCount: 99 }),
  ]);

  const merged = api.mergeFetchedCommentSeeds(first, second);
  assert.deepEqual(Array.from(merged, ({ sourceId }) => sourceId), ["first", "second"]);
  assert.equal(merged[0].likeCount, 99);
});

test("anonymous records use content signatures instead of merging by result order alone", async () => {
  const { api } = await loadRuntime();
  const first = api.createFetchedCommentSeeds([comment({
    commentId: "",
    order: 0,
    text: "0:00 First opening\n0:30 First middle\n1:00 First finale",
  })]);
  const second = api.createFetchedCommentSeeds([comment({
    commentId: "",
    order: 0,
    text: "0:00 Other opening\n0:45 Other middle\n1:30 Other finale",
  })]);
  const merged = api.mergeFetchedCommentSeeds(first, second);

  assert.equal(merged.length, 2);
  assert.ok(merged.every(({ sourceId }) => sourceId.startsWith("anonymous-")));
  assert.notEqual(merged[0].sourceId, merged[1].sourceId);

  const lookalikes = api.createFetchedCommentSeeds([
    comment({ commentId: "", order: 0 }),
    comment({ commentId: "", order: 1 }),
  ]);
  assert.notEqual(
    lookalikes[0].sourceId,
    lookalikes[1].sourceId,
    "distinct identifier-free records in one batch must not collapse"
  );
});

test("a longer noisy retry cannot replace an earlier viable candidate run", async () => {
  const { api, selection } = await loadRuntime();
  const previous = api.createFetchedCommentSeeds([comment({
    text: "0:00 Opening\n0:30 Middle\n1:00 Finale",
  })]);
  const noisy = api.createFetchedCommentSeeds([comment({
    text: "0:00 Opening\n0:30 Middle\n0:10 Noise\n0:20 More noise",
  })]);
  const merged = api.mergeFetchedCommentSeeds(previous, noisy);
  const result = api.selectFetchedCommentSource({
    duration: 90,
    generation: 1,
    seeds: merged,
    status: selection.TRACK_SOURCE_STATUSES.SETTLED,
    videoId: "album",
  });

  assert.equal(merged[0].candidateVariants.length, 2);
  assert.deepEqual(Array.from(result.tracks, ({ start }) => start), [0, 30, 60]);
});

test("matching retry variants enrich truncated titles without duplicating timing sets", async () => {
  const { api } = await loadRuntime();
  const previous = api.createFetchedCommentSeeds([comment({
    text: "0:00 Opening...\n0:30 Middle\n1:00 Finale",
  })]);
  const incoming = api.createFetchedCommentSeeds([comment({
    text: "0:00 Detailed opening\n0:30 Middle\n1:00 Finale",
  })]);
  const merged = api.mergeFetchedCommentSeeds(previous, incoming);

  assert.equal(merged[0].candidateVariants.length, 1);
  assert.equal(merged[0].candidateVariants[0][0].title, "Detailed opening");
});

test("distinct retries remain independently ranked with stable equal-score ordering", async () => {
  const { api, selection } = await loadRuntime();
  const first = api.createFetchedCommentSeeds([comment({
    commentId: "first",
    text: "0:00 First\n0:30 Middle\n1:00 Finale",
  })]);
  const second = api.createFetchedCommentSeeds([comment({
    commentId: "second",
    order: 1,
    text: "0:00 Second\n0:30 Middle\n1:00 Finale",
  })]);
  const merged = api.mergeFetchedCommentSeeds(first, second);
  const result = api.selectFetchedCommentSource({
    duration: 90,
    generation: 1,
    seeds: merged,
    status: selection.TRACK_SOURCE_STATUSES.SETTLED,
    videoId: "album",
  });

  assert.equal(result.source.id, "first");
  assert.equal(result.tracks[0].title, "First");
});

test("a genuinely stronger retry source replaces the earlier provisional winner", async () => {
  const { api, selection } = await loadRuntime();
  const regular = api.createFetchedCommentSeeds([comment({
    commentId: "regular",
    text: "0:00 Regular\n0:30 Middle\n1:00 Finale",
  })]);
  const pinned = api.createFetchedCommentSeeds([comment({
    commentId: "pinned",
    isPinned: true,
    text: "0:00 Pinned\n0:30 Middle\n1:00 Finale",
  })]);
  const result = api.selectFetchedCommentSource({
    duration: 90,
    generation: 1,
    seeds: api.mergeFetchedCommentSeeds(regular, pinned),
    status: selection.TRACK_SOURCE_STATUSES.SETTLED,
    videoId: "album",
  });

  assert.equal(result.source.id, "pinned");
  assert.equal(result.tracks[0].title, "Pinned");
});

test("caps retained records and candidates deterministically", async () => {
  const { api } = await loadRuntime();
  const manyLines = Array.from(
    { length: api.MAX_FETCHED_COMMENT_CANDIDATES + 20 },
    (_, index) => `${Math.floor(index / 60)}:${String(index % 60).padStart(2, "0")} Track ${index}`
  ).join("\n");
  const records = Array.from(
    { length: api.MAX_FETCHED_COMMENT_SEEDS + 20 },
    (_, index) => comment({ commentId: `comment-${index}`, order: index, text: manyLines })
  );

  const seeds = api.createFetchedCommentSeeds(records);
  assert.equal(seeds.length, api.MAX_FETCHED_COMMENT_SEEDS);
  assert.ok(seeds.every(({ candidateVariants }) => {
    return candidateVariants.length === 1
      && candidateVariants[0].length === api.MAX_FETCHED_COMMENT_CANDIDATES;
  }));
});

test("deduplicates timestamps on one line before applying the candidate cap", async () => {
  const { api } = await loadRuntime();
  const crowdedLine = Array.from(
    { length: api.MAX_FETCHED_COMMENT_CANDIDATES + 20 },
    (_, index) => `${Math.floor(index / 60)}:${String(index % 60).padStart(2, "0")}`
  ).join(" ");
  const seeds = api.createFetchedCommentSeeds([comment({
    text: `${crowdedLine}\n5:00 Later one\n6:00 Later two\n7:00 Later three`,
  })]);

  assert.equal(seeds.length, 1);
  assert.deepEqual(
    Array.from(seeds[0].candidateVariants[0], ({ start }) => start),
    [0, 300, 360, 420]
  );
});

test("extension wiring loads bounded fetched seeds before discovery", async () => {
  const [manifest, packageJson] = await Promise.all([
    readFile(new URL("../manifest.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const scripts = manifest.content_scripts[0].js;
  const selectionIndex = scripts.indexOf("src/track-selection.js");
  const fetchedIndex = scripts.indexOf("src/fetched-comment-sources.js");
  const discoveryIndex = scripts.indexOf("src/track-discovery.js");

  assert.ok(fetchedIndex > selectionIndex);
  assert.ok(fetchedIndex > scripts.indexOf("src/comment-scoring.js"));
  assert.ok(fetchedIndex < discoveryIndex);
  assert.equal(
    packageJson.scripts["test:fetched-comment-sources"],
    "node --test tests/fetched-comment-sources.test.mjs"
  );
});
