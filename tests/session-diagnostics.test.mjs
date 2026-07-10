import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadSessionDiagnostics() {
  const [debugSource, diagnosticsSource] = await Promise.all([
    readFile(new URL("../src/debug.js", import.meta.url), "utf8"),
    readFile(new URL("../src/session-diagnostics.js", import.meta.url), "utf8"),
  ]);
  const context = vm.createContext({});
  vm.runInContext(debugSource, context);
  vm.runInContext(diagnosticsSource, context);
  return {
    debug: context.TimestampPlayerDebug,
    diagnostics: context.TimestampPlayerSessionDiagnostics,
  };
}

function createFakeLogger({ enabled = true } = {}) {
  const calls = [];
  return {
    calls,
    isEnabled: () => enabled,
    log(event, fields) {
      calls.push({ event, fields });
      return true;
    },
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createSession() {
  return {
    generation: 3,
    videoId: "album_123-ABC",
    startedAt: 100,
    retries: {
      launcher: {
        attempt: 0,
        exhausted: false,
        startedAt: null,
      },
    },
    commentDiscovery: {
      attempt: 1,
      attemptStartedAt: 120,
    },
    trackSelection: {
      observation: 4,
    },
  };
}

test("formats session lifecycle, discovery, and retry events", async () => {
  const {
    debug: { DEBUG_EVENTS },
    diagnostics: { createSessionDiagnostics },
  } = await loadSessionDiagnostics();
  const logger = createFakeLogger();
  const diagnostics = createSessionDiagnostics({ logger, now: () => 175 });
  const session = createSession();
  const transition = {
    changed: true,
    current: { reason: "scanning-sources", status: "pending" },
    previous: { reason: "starting", status: "pending" },
  };

  diagnostics.sessionStarted(session);
  diagnostics.discoveryTransition(session, transition);
  diagnostics.retryScheduled(session, "sourceDiscovery", {
    attempt: 2,
    delayMs: 250,
  });
  diagnostics.retryExhausted(session, "sourceDiscovery", {
    attempt: 6,
    exhausted: true,
    startedAt: 125,
  });
  diagnostics.sessionEnded(session, "video-changed");

  assert.deepEqual(logger.calls.map(({ event }) => event), [
    DEBUG_EVENTS.SESSION_STARTED,
    DEBUG_EVENTS.DISCOVERY_TRANSITION,
    DEBUG_EVENTS.RETRY_SCHEDULED,
    DEBUG_EVENTS.RETRY_EXHAUSTED,
    DEBUG_EVENTS.SESSION_ENDED,
  ]);
  assert.deepEqual(plain(logger.calls[1].fields), {
    generation: 3,
    videoId: "album_123-ABC",
    previousStatus: "pending",
    previousReason: "starting",
    status: "pending",
    reason: "scanning-sources",
    elapsedMs: 75,
  });
  assert.equal(logger.calls[2].fields.delayMs, 250);
  assert.equal(logger.calls[3].fields.elapsedMs, 50);
  assert.equal(logger.calls[4].fields.sessionEndReason, "video-changed");
  assert.equal(diagnostics.discoveryTransition(session, { changed: false }), false);
});

test("deduplicates video resolution and launcher snapshots per session", async () => {
  const {
    debug: { DEBUG_EVENTS },
    diagnostics: { createSessionDiagnostics },
  } = await loadSessionDiagnostics();
  const logger = createFakeLogger();
  const diagnostics = createSessionDiagnostics({ logger, now: () => 200 });
  const session = createSession();

  assert.equal(diagnostics.videoResolution(session, {
    reason: "current-watch-player",
    status: "ready",
  }), true);
  assert.equal(diagnostics.videoResolution(session, {
    reason: "current-watch-player",
    status: "ready",
  }), false);
  assert.equal(diagnostics.videoResolution(session, {
    reason: "main-player-ad-showing",
    status: "ad-playing",
  }), true);

  assert.equal(diagnostics.launcherSync(session, false), true);
  assert.equal(diagnostics.launcherSync(session, false), false);
  session.retries.launcher.attempt = 1;
  assert.equal(diagnostics.launcherSync(session, false), true);
  assert.equal(diagnostics.launcherSync(session, true), true);

  assert.deepEqual(
    logger.calls.filter(({ event }) => event === DEBUG_EVENTS.VIDEO_RESOLUTION)
      .map(({ fields }) => [fields.videoStatus, fields.videoReason]),
    [
      ["ready", "current-watch-player"],
      ["ad-playing", "main-player-ad-showing"],
    ]
  );
  assert.deepEqual(
    logger.calls.filter(({ event }) => event === DEBUG_EVENTS.LAUNCHER_SYNC)
      .map(({ fields }) => [fields.attached, fields.attempt]),
    [
      [false, 0],
      [false, 1],
      [true, 1],
    ]
  );
});

test("reports aggregate source attempts and only structured selection fields", async () => {
  const {
    debug: { DEBUG_EVENTS },
    diagnostics: { createSessionDiagnostics },
  } = await loadSessionDiagnostics();
  const logger = createFakeLogger();
  const diagnostics = createSessionDiagnostics({ logger });
  const session = createSession();
  const result = {
    ownership: { confidence: "strong" },
    source: { channel: "description-dom", kind: "description" },
    status: "settled",
    tracks: [
      { title: "Private track title" },
      { title: "Another private title" },
    ],
  };

  assert.equal(diagnostics.sourceObserved(session, [], {
    candidateCount: 1,
    sourceChannel: "native-dom",
    sourceKind: "native",
  }), 1);
  assert.equal(diagnostics.sourceObserved(session, [result], {
    candidateCount: 3,
  }), 1);
  assert.equal(diagnostics.sourceDecision(session, result, {
    accepted: true,
    awaitingConfirmation: false,
    changed: true,
    decisionReason: "accepted",
  }), true);

  const sourceEvents = logger.calls.filter(({ event }) => {
    return event === DEBUG_EVENTS.SOURCE_OBSERVED;
  });
  assert.equal(sourceEvents[0].fields.trackCount, 0);
  assert.equal(sourceEvents[1].fields.trackCount, 2);
  assert.equal(sourceEvents[1].fields.candidateCount, 3);
  assert.equal(sourceEvents[1].fields.settled, true);
  assert.equal(Object.hasOwn(sourceEvents[1].fields, "tracks"), false);
  assert.equal(Object.hasOwn(sourceEvents[1].fields, "title"), false);
  const decision = logger.calls.find(({ event }) => {
    return event === DEBUG_EVENTS.SOURCE_DECISION;
  }).fields;
  assert.equal(decision.sourceChannel, "description-dom");
  assert.equal(decision.trackCount, 2);
  assert.equal(Object.hasOwn(decision, "tracks"), false);
});

test("reduces comment results to safe categories and counts", async () => {
  const {
    debug: { DEBUG_EVENTS },
    diagnostics: { createSessionDiagnostics },
  } = await loadSessionDiagnostics();
  const logger = createFakeLogger();
  const diagnostics = createSessionDiagnostics({ logger, now: () => 170 });
  const session = createSession();
  const result = {
    batchesFetched: 2,
    reason: "unsafe-continuation-api-url",
    records: [
      { text: "Private comment body", token: "private-token" },
      { text: "Another private comment" },
    ],
    retryable: true,
    status: "partial",
  };

  diagnostics.commentFetchStarted(session);
  diagnostics.commentFetchResult(session, result, 1);

  assert.equal(logger.calls[0].event, DEBUG_EVENTS.COMMENT_FETCH_STARTED);
  assert.deepEqual(plain(logger.calls[1]), {
    event: DEBUG_EVENTS.COMMENT_FETCH_RESULT,
    fields: {
      generation: 3,
      videoId: "album_123-ABC",
      attempt: 1,
      outcome: "partial",
      failureCategory: "unsafe-endpoint",
      retryable: true,
      batchesFetched: 2,
      recordCount: 2,
      resultCount: 1,
      elapsedMs: 50,
    },
  });
  assert.equal(JSON.stringify(logger.calls).includes("Private"), false);
  assert.equal(JSON.stringify(logger.calls).includes("token"), false);
});

test("disabled diagnostics do not inspect result payloads", async () => {
  const {
    diagnostics: { createSessionDiagnostics },
  } = await loadSessionDiagnostics();
  const logger = createFakeLogger({ enabled: false });
  const diagnostics = createSessionDiagnostics({ logger });
  const session = createSession();
  let inspected = false;
  const result = new Proxy({}, {
    get() {
      inspected = true;
      throw new Error("disabled diagnostics must not inspect results");
    },
  });

  assert.equal(diagnostics.sourceObserved(session, result), 0);
  assert.equal(diagnostics.sourceDecision(session, result, {}), false);
  assert.equal(diagnostics.commentFetchResult(session, result, 0), false);
  assert.equal(inspected, false);
  assert.equal(logger.calls.length, 0);
});
