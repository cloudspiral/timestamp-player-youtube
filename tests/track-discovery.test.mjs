import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadTrackDiscovery({
  fetchImpl = async () => ({
    batchesFetched: 1,
    reason: "complete",
    records: [],
    retryable: false,
    status: "success",
  }),
  nativeDiscovery = { candidates: [], hasMismatchedVideoId: false },
} = {}) {
  const [timestampSource, selectionSource, discoverySource] = await Promise.all([
    readFile(new URL("../src/timestamps.js", import.meta.url), "utf8"),
    readFile(new URL("../src/track-selection.js", import.meta.url), "utf8"),
    readFile(new URL("../src/track-discovery.js", import.meta.url), "utf8"),
  ]);
  const resetCalls = [];
  const context = vm.createContext({
    AbortController,
    TimestampPlayerCommentFetching: {
      COMMENT_FETCH_OUTCOMES: {
        PARTIAL: "partial",
        SUCCESS: "success",
        TRANSIENT_ERROR: "transient-error",
        UNSUPPORTED: "unsupported",
      },
      fetchCommentRecords: fetchImpl,
    },
    TimestampPlayerCommentScoring: {
      scoreCommentTrackSource: ({ order, sourceType }) => {
        return 100 - order + (sourceType === "pinned" ? 50 : 0);
      },
    },
    TimestampPlayerDiscoveryCache: {
      retainFetchedCommentResult: (current, incoming) => incoming || current,
    },
    TimestampPlayerNativeTimestamps: {
      getNativeTimestampDiscovery: () => nativeDiscovery,
    },
    TimestampPlayerWatchSession: {
      COMMENT_DISCOVERY_STATUSES: {
        DONE: "done",
        IDLE: "idle",
        PENDING: "pending",
        RETRY_WAIT: "retry-wait",
      },
      resetSessionRetry: (session, name) => resetCalls.push({ name, session }),
    },
  });
  vm.runInContext(timestampSource, context);
  vm.runInContext(selectionSource, context);
  vm.runInContext(discoverySource, context);
  return {
    api: context.TimestampPlayerTrackDiscovery,
    resetCalls,
    selection: context.TimestampPlayerTrackSelection,
  };
}

function timestampCandidates(sourceId = "fixture") {
  return [
    { lineKey: `${sourceId}:0`, sourceId, start: 0, timestampText: "0:00", title: "Opening" },
    { lineKey: `${sourceId}:1`, sourceId, start: 30, timestampText: "0:30", title: "Middle" },
    { lineKey: `${sourceId}:2`, sourceId, start: 60, timestampText: "1:00", title: "Finale" },
  ];
}

function createSession(selection, { commentStatus = "idle" } = {}) {
  return {
    abortController: new AbortController(),
    commentDiscovery: {
      attempt: 0,
      attemptStartedAt: null,
      result: null,
      status: commentStatus,
    },
    domSources: { ids: new WeakMap(), nextId: 1 },
    generation: 3,
    trackSelection: selection.createTrackSelectionState(),
    videoId: "album",
  };
}

function createController(api, overrides = {}) {
  const diagnostics = {
    commentFetchResult() {},
    commentFetchStarted() {},
  };
  return api.createTrackDiscoveryController({
    diagnostics,
    isCurrentSession: () => true,
    scheduleScan: () => true,
    scheduleTrackedSessionRetry: () => false,
    youtubeDom: {},
    ...overrides,
  });
}

test("description, visible-comment, and native discovery retain separate provenance", async () => {
  const nativeCandidates = timestampCandidates("native").map((candidate) => ({
    ...candidate,
    linkedVideoId: "album",
    shellVideoId: "",
  }));
  const { api, selection } = await loadTrackDiscovery({
    nativeDiscovery: { candidates: nativeCandidates, hasMismatchedVideoId: false },
  });
  const session = createSession(selection);
  const descriptionRoot = {};
  const commentRoot = {};
  const quietRoot = {};
  const youtubeDom = {
    getCommentRoots: () => [commentRoot],
    getDescriptionRoots: () => [descriptionRoot],
    getOwnershipEvidence: () => ({ linkedVideoIds: ["album"], shellVideoId: "" }),
    getQuietDescriptionRoots: () => [quietRoot],
    isDescriptionRootReadable: (root) => root === quietRoot,
    readCommentRoot: () => ({
      candidates: timestampCandidates("comment"),
      isPinned: true,
      isUploader: false,
      likeCount: 25,
    }),
    readDescriptionRoot: () => ({
      candidateCount: 3,
      candidates: timestampCandidates("description"),
    }),
  };
  const controller = createController(api, { youtubeDom });
  const description = controller.getDescriptionSourceResults(session, 90, 1);
  const comments = controller.getDomCommentSourceResults(
    session,
    90,
    1,
    selection.TRACK_SOURCE_STATUSES.PROVISIONAL
  );
  const native = controller.getNativeSourceDiscovery(session, 90, 1);

  assert.equal(description.results.length, 1);
  assert.equal(description.results[0].source.kind, selection.TRACK_SOURCE_KINDS.DESCRIPTION);
  assert.equal(description.results[0].source.channel, "description-dom");
  assert.equal(comments.results.length, 1);
  assert.equal(comments.results[0].source.kind, selection.TRACK_SOURCE_KINDS.COMMENT);
  assert.equal(comments.results[0].source.channel, "comment-dom");
  assert.equal(comments.results[0].sourceScore, 150);
  assert.equal(native.result.source.kind, selection.TRACK_SOURCE_KINDS.NATIVE);
  assert.equal(native.result.status, selection.TRACK_SOURCE_STATUSES.PROVISIONAL);
  assert.equal(controller.canReadQuietDescription("album"), true);
});

test("fetched comment discovery starts immediately and settles into normalized tracks", async () => {
  const requests = [];
  const fetchResult = {
    batchesFetched: 1,
    reason: "complete",
    records: [{
      commentId: "comment-1",
      isPinned: false,
      isUploader: true,
      likeCount: 12,
      order: 0,
      text: "0:00 Opening\n0:30 Middle\n1:00 Finale",
    }],
    retryable: false,
    status: "success",
  };
  const { api, resetCalls, selection } = await loadTrackDiscovery({
    fetchImpl: async (request) => {
      requests.push(request);
      return fetchResult;
    },
  });
  const session = createSession(selection);
  let scans = 0;
  const diagnostics = { results: 0, starts: 0 };
  const controller = createController(api, {
    diagnostics: {
      commentFetchResult: () => {
        diagnostics.results += 1;
      },
      commentFetchStarted: () => {
        diagnostics.starts += 1;
      },
    },
    scheduleScan: () => {
      scans += 1;
      return true;
    },
    youtubeDom: {
      getQuietDescriptionRoots: () => [],
    },
  });

  const discovery = controller.getFetchedCommentDiscoveryForSession(session, 90);
  assert.equal(discovery.status, "pending");
  assert.equal(controller.isCommentDiscoveryPending(session), true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].maxBatches, 3);
  assert.equal(requests[0].signal, session.abortController.signal);

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(discovery.status, "done");
  assert.equal(controller.isCommentDiscoveryPending(session), false);
  assert.equal(discovery.result.source.channel, "comment-api");
  assert.equal(discovery.result.source.kind, selection.TRACK_SOURCE_KINDS.COMMENT);
  assert.equal(discovery.result.tracks.length, 3);
  assert.equal(diagnostics.starts, 1);
  assert.equal(diagnostics.results, 1);
  assert.equal(scans, 1);
  assert.deepEqual(resetCalls.map(({ name }) => name), ["commentFetch"]);
});

test("pending fetches start once and stale completion cannot mutate a replaced session", async () => {
  let resolveFetch;
  const fetchPromise = new Promise((resolve) => {
    resolveFetch = resolve;
  });
  const { api, selection } = await loadTrackDiscovery({
    fetchImpl: () => fetchPromise,
  });
  const session = createSession(selection);
  let current = true;
  let scans = 0;
  let results = 0;
  const controller = createController(api, {
    diagnostics: {
      commentFetchResult: () => {
        results += 1;
      },
      commentFetchStarted() {},
    },
    isCurrentSession: () => current,
    scheduleScan: () => {
      scans += 1;
      return true;
    },
    youtubeDom: { getQuietDescriptionRoots: () => [] },
  });

  const first = controller.getFetchedCommentDiscoveryForSession(session, 90);
  const second = controller.getFetchedCommentDiscoveryForSession(session, 90);
  assert.equal(first, second);
  assert.equal(first.attempt, 1, "repeated reads while pending must not start another request");

  current = false;
  resolveFetch({
    batchesFetched: 1,
    reason: "complete",
    records: [{
      commentId: "stale",
      order: 0,
      text: "0:00 Old\n0:30 Old two\n1:00 Old three",
    }],
    retryable: false,
    status: "success",
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(first.status, "pending");
  assert.equal(first.result, null);
  assert.equal(results, 0);
  assert.equal(scans, 0);
});

test("retryable comment results stay provisional and settle on one bounded retry", async () => {
  const outcomes = [
    {
      batchesFetched: 1,
      reason: "continuation-failed",
      records: [{
        commentId: "partial",
        isPinned: true,
        order: 0,
        text: "0:00 Partial one\n0:30 Partial two\n1:00 Partial three",
      }],
      retryable: true,
      status: "partial",
    },
    {
      batchesFetched: 2,
      reason: "complete",
      records: [{
        commentId: "complete",
        isPinned: true,
        order: 0,
        text: "0:00 Complete one\n0:30 Complete two\n1:00 Complete three",
      }],
      retryable: false,
      status: "success",
    },
  ];
  let requestCount = 0;
  const { api, selection } = await loadTrackDiscovery({
    fetchImpl: async () => outcomes[requestCount++],
  });
  const session = createSession(selection);
  const retryCallbacks = [];
  let scans = 0;
  const controller = createController(api, {
    scheduleScan: () => {
      scans += 1;
      return true;
    },
    scheduleTrackedSessionRetry: (_session, name, callback) => {
      assert.equal(name, "commentFetch");
      retryCallbacks.push(callback);
      return true;
    },
    youtubeDom: { getQuietDescriptionRoots: () => [] },
  });

  const discovery = controller.getFetchedCommentDiscoveryForSession(session, 90);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(discovery.status, "retry-wait");
  assert.equal(discovery.result.status, selection.TRACK_SOURCE_STATUSES.PROVISIONAL);
  assert.equal(retryCallbacks.length, 1);
  retryCallbacks[0]();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(requestCount, 2);
  assert.equal(discovery.status, "done");
  assert.equal(discovery.result.status, selection.TRACK_SOURCE_STATUSES.SETTLED);
  assert.deepEqual(
    Array.from(discovery.result.tracks, ({ title }) => title),
    ["Complete one", "Complete two", "Complete three"]
  );
  assert.equal(scans, 2);
});

test("DOM source IDs stay stable, wrong videos are rejected, and regular scans are bounded", async () => {
  const { api, selection } = await loadTrackDiscovery();
  const session = createSession(selection);
  const stableDescription = {};
  const wrongDescription = {};
  const regularComments = Array.from({ length: 31 }, () => ({}));
  const youtubeDom = {
    getCommentRoots: () => regularComments,
    getDescriptionRoots: () => [stableDescription, wrongDescription],
    getOwnershipEvidence: (root) => ({
      linkedVideoIds: [root === wrongDescription ? "old-video" : "album"],
      shellVideoId: "",
    }),
    getQuietDescriptionRoots: () => [],
    readCommentRoot: () => ({
      candidates: timestampCandidates("regular"),
      isPinned: false,
      isUploader: false,
      likeCount: 0,
    }),
    readDescriptionRoot: () => ({
      candidateCount: 3,
      candidates: timestampCandidates("stable"),
    }),
  };
  const controller = createController(api, { youtubeDom });
  const first = controller.getDescriptionSourceResults(session, 90, 1);
  const second = controller.getDescriptionSourceResults(session, 90, 2);
  const comments = controller.getDomCommentSourceResults(
    session,
    90,
    2,
    selection.TRACK_SOURCE_STATUSES.SETTLED
  );

  assert.equal(first.results.length, 1, "wrong-video description roots must be rejected");
  assert.equal(first.results[0].source.id, second.results[0].source.id);
  assert.equal(comments.results.length, 30);
  assert.equal(comments.candidateCount, 93);
});

test("controller validates its orchestration dependencies", async () => {
  const { api } = await loadTrackDiscovery();
  assert.throws(() => api.createTrackDiscoveryController({}), /dependencies are required/);
});

test("extension wiring loads track discovery after its sources and before content", async () => {
  const [manifest, packageJson, contentSource] = await Promise.all([
    readFile(new URL("../manifest.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../src/content.js", import.meta.url), "utf8"),
  ]);
  const scripts = manifest.content_scripts[0].js;
  const discoveryIndex = scripts.indexOf("src/track-discovery.js");

  assert.ok(discoveryIndex > scripts.indexOf("src/watch-session.js"));
  assert.ok(discoveryIndex > scripts.indexOf("src/youtube-dom.js"));
  assert.ok(discoveryIndex < scripts.indexOf("src/content.js"));
  assert.match(contentSource, /createTrackDiscoveryController\(\{/);
  assert.match(contentSource, /trackDiscovery\.getDescriptionSourceResults\(/);
  assert.match(contentSource, /trackDiscovery\.getFetchedCommentDiscoveryForSession\(/);
  assert.doesNotMatch(contentSource, /function startCommentFetch\b/);
  assert.equal(
    packageJson.scripts["test:track-discovery"],
    "node --test tests/track-discovery.test.mjs"
  );
});
