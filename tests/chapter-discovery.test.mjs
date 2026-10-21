import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function setup({ localPage = null, fetchPage = async () => ({ initialData: null }), nativeGroups = [] } = {}) {
  const context = vm.createContext({ AbortController });
  for (const name of ["timestamps", "chapter-data", "track-selection", "discovery-status", "watch-session"]) {
    vm.runInContext(await readFile(new URL(`../src/${name}.js`, import.meta.url), "utf8"), context);
  }
  let reads = localPage;
  let fetches = 0;
  let current = true;
  const scans = [];
  const retries = [];
  const loader = {
    readDocument: () => reads,
    fetchPage: () => { fetches++; return fetchPage(); },
    retryTransient() {},
    load: () => reads,
  };
  context.TimestampPlayerYouTubePageData = { createPageDataLoader: () => loader };
  context.TimestampPlayerCommentScoring = {};
  context.TimestampPlayerCommentFetching = {};
  context.TimestampPlayerFetchedCommentSources = {};
  context.TimestampPlayerNativeTimestamps = { getNativeTimestampDiscovery: () => ({
    groups: nativeGroups, candidates: nativeGroups.flatMap((group) => group.candidates),
  }) };
  vm.runInContext(await readFile(new URL("../src/track-discovery.js", import.meta.url), "utf8"), context);
  const session = context.TimestampPlayerWatchSession.createWatchSession({ generation: 1, videoId: "vBv5-xa_hgQ" });
  const controller = context.TimestampPlayerTrackDiscovery.createTrackDiscoveryController({
    diagnostics: {}, youtubeDom: {}, isCurrentSession: () => current,
    scheduleScan: (s) => scans.push(s),
    scheduleTrackedSessionRetry: (_session, name, callback) => {
      if (retries.length) return false;
      retries.push({ name, callback });
      return true;
    },
  });
  return {
    session, controller, scans, retries, selection: context.TimestampPlayerTrackSelection,
    fetches: () => fetches,
    setCurrent: (value) => { current = value; },
    setPage: (value) => { reads = value; },
  };
}

async function reportedPage() {
  return { initialData: JSON.parse(await readFile(new URL("./fixtures/chapters/reported-video.json", import.meta.url), "utf8")) };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("embedded chapters settle without any comment/network dependency and rebase to corrected duration", async () => {
  const api = await setup({ localPage: await reportedPage() });
  const first = api.controller.getChapterSourceDiscovery(api.session, 2729, 1);
  assert.equal(first.results[0].tracks.length, 19);
  assert.equal(first.results[0].status, "settled");
  assert.equal(api.session.commentDiscovery.status, "idle");
  const rebased = api.controller.getChapterSourceDiscovery(api.session, 2800, 2);
  assert.equal(rebased.results[0].tracks.at(-1).end, 2800);
  assert.equal(api.fetches(), 0);
});

test("late fetched chapters upgrade an already settled reaction comment without merging its boundaries", async () => {
  let release;
  const api = await setup({ fetchPage: () => new Promise((resolve) => { release = resolve; }) });
  const sel = api.session.trackSelection;
  const owner = { videoId: api.session.videoId, generation: 1, duration: 2729 };
  const comment = api.selection.createTrackSourceResult({
    ...owner, kind: "comment", sourceId: "reaction", status: "settled", sourceScore: 1000,
    ownership: { confidence: "strong" },
    tracks: [486, 1039, 1477].map((start, i, starts) => ({ start, end: starts[i + 1] || 2729, title: "Reaction" })),
  });
  api.selection.considerTrackSource(sel, comment, owner);
  assert.equal(api.controller.getChapterSourceDiscovery(api.session, 2729, 1).results.length, 0);
  api.controller.getChapterSourceDiscovery(api.session, 2729, 2);
  assert.equal(api.fetches(), 1);
  release(await reportedPage());
  await flush();
  const [chapter] = api.controller.getChapterSourceDiscovery(api.session, 2729, 3).results;
  api.selection.considerTrackSource(sel, chapter, owner);
  assert.equal(sel.current.source.kind, "chapter");
  assert.equal(sel.current.tracks.length, 19);
  assert.equal(sel.current.tracks.some((track) => track.start === 486), false);
  assert.equal(api.scans.length, 1);
});

test("previous-navigation responses cannot commit chapter data or schedule scans", async () => {
  let release;
  const api = await setup({ fetchPage: () => new Promise((resolve) => { release = resolve; }) });
  api.controller.getChapterSourceDiscovery(api.session, 2729, 1);
  api.setCurrent(false);
  release(await reportedPage());
  await flush();
  assert.equal(api.session.chapterDiscovery.sets.length, 0);
  assert.equal(api.scans.length, 0);
});

test("a transient chapter request retries once and then settles without suppressing fallbacks", async () => {
  const api = await setup({ fetchPage: async () => { throw { kind: "transient", reason: "timeout" }; } });
  api.controller.getChapterSourceDiscovery(api.session, 2729, 1);
  await flush();
  assert.equal(api.retries[0].name, "chapterFetch");
  assert.equal(api.controller.isChapterDiscoveryPending(api.session), true);
  api.retries[0].callback();
  await flush();
  assert.equal(api.session.chapterDiscovery.status, "done");
  assert.equal(api.controller.isChapterDiscoveryPending(api.session), false);
  assert.equal(api.fetches(), 2);
});

test("DOM chapter panels preserve independent provenance; sparse/generic groups remain native", async () => {
  const candidates = (starts) => starts.map((start, i) => ({ start, title: `Part ${i}`, linkedVideoId: "vBv5-xa_hgQ" }));
  const api = await setup({ nativeGroups: [
    { panelId: "engagement-panel-macro-markers-description-chapters", candidates: candidates([0, 10, 20]) },
    { panelId: "engagement-panel-macro-markers-auto-chapters", candidates: candidates([207, 429, 782]) },
    { panelId: "", candidates: candidates([0, 30, 60]) },
    { panelId: "engagement-panel-macro-markers-auto-chapters", incomplete: true, candidates: candidates([0, 70]) },
  ] });
  const { results } = api.controller.getNativeSourceDiscovery(api.session, 2729, 1);
  assert.equal(results.length, 3);
  assert.equal(results[0].source.kind, "chapter");
  assert.equal(results[0].source.chapterKind, "manual");
  assert.equal(results[0].source.channel, "chapter-dom");
  assert.equal(results[1].source.kind, "native");
  assert.equal(results[2].source.kind, "native");
  assert.equal(results[0].tracks.length, 3);
});
