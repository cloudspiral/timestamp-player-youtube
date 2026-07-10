import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadDebug(contextValues = {}) {
  const source = await readFile(new URL("../src/debug.js", import.meta.url), "utf8");
  const context = vm.createContext(contextValues);
  vm.runInContext(source, context);
  return context.TimestampPlayerDebug;
}

async function loadDiscoveryStatus() {
  const source = await readFile(
    new URL("../src/discovery-status.js", import.meta.url),
    "utf8"
  );
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return context.TimestampPlayerDiscoveryStatus;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("is silent unless its injected opt-in is explicitly true", async () => {
  const { DEBUG_EVENTS, createDebugLogger } = await loadDebug();
  const calls = [];
  let enabled = false;
  const logger = createDebugLogger({
    isEnabled: () => enabled,
    sink: (...args) => calls.push(args),
  });

  assert.equal(logger.log(DEBUG_EVENTS.SESSION_STARTED, { generation: 1 }), false);
  assert.equal(calls.length, 0);

  enabled = true;
  assert.equal(logger.log(DEBUG_EVENTS.SESSION_STARTED, { generation: 1 }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "[TimestampPlayer] session.started");
  assert.deepEqual(plain(calls[0][1]), { generation: 1 });
});

test("reads the tab-scoped session flag for every call", async () => {
  const values = new Map();
  const sessionStorage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
  };
  const {
    DEBUG_EVENTS,
    DEBUG_FLAG_KEY,
    createDebugLogger,
  } = await loadDebug({ sessionStorage });
  const calls = [];
  const logger = createDebugLogger({ sink: (...args) => calls.push(args) });

  assert.equal(
    logger.log(DEBUG_EVENTS.DISCOVERY_TRANSITION, { status: "pending" }),
    false
  );
  values.set(DEBUG_FLAG_KEY, "1");
  assert.equal(
    logger.log(DEBUG_EVENTS.DISCOVERY_TRANSITION, { status: "pending" }),
    true
  );
  values.delete(DEBUG_FLAG_KEY);
  assert.equal(
    logger.log(DEBUG_EVENTS.DISCOVERY_TRANSITION, { status: "ready" }),
    false
  );
  assert.equal(calls.length, 1);
});

test("uses a fixed event set and freezes its public event constants", async () => {
  const { DEBUG_EVENTS, createDebugLogger } = await loadDebug();
  const calls = [];
  const logger = createDebugLogger({
    isEnabled: () => true,
    sink: (...args) => calls.push(args),
  });

  for (const event of Object.values(DEBUG_EVENTS)) {
    assert.equal(
      logger.log(event, { generation: 1, videoId: "album_123-ABC" }),
      true,
      event
    );
  }

  assert.equal(Object.isFrozen(DEBUG_EVENTS), true);
  assert.equal(calls.length, Object.keys(DEBUG_EVENTS).length);
  assert.equal(logger.log("discovery.status", { status: "pending" }), false);
  assert.equal(logger.log("custom.token-shaped-event", { generation: 1 }), false);
  assert.equal(logger.log("unsafe event token=secret", { generation: 1 }), false);
  assert.equal(calls.length, Object.keys(DEBUG_EVENTS).length);
});

test("emits only fields allowed by the selected event", async () => {
  const { DEBUG_EVENTS, createDebugLogger } = await loadDebug();
  const calls = [];
  const logger = createDebugLogger({
    isEnabled: () => true,
    sink: (...args) => calls.push(args),
  });
  const fields = {
    accepted: true,
    awaitingConfirmation: false,
    changed: true,
    decisionReason: "source-replaced",
    generation: 3,
    outcome: "partial",
    ownershipConfidence: "strong",
    sourceChannel: "comment-api",
    sourceKind: "comment",
    trackCount: 9,
    videoId: "album_123-ABC",
  };

  logger.log(DEBUG_EVENTS.SOURCE_DECISION, fields);

  assert.deepEqual(plain(calls[0][1]), {
    generation: 3,
    videoId: "album_123-ABC",
    sourceKind: "comment",
    sourceChannel: "comment-api",
    accepted: true,
    changed: true,
    decisionReason: "source-replaced",
    trackCount: 9,
    awaitingConfirmation: false,
  });
  assert.equal(Object.isFrozen(calls[0][1]), true);
  assert.equal(
    Object.hasOwn(calls[0][1], "outcome"),
    false,
    "a valid field for another event must still be excluded"
  );
  assert.equal(Object.hasOwn(calls[0][1], "ownershipConfidence"), false);
});

test("accepts closed diagnostic enums and finite non-negative numeric fields", async () => {
  const { DEBUG_EVENTS, sanitizeDebugFields } = await loadDebug();
  const result = sanitizeDebugFields(DEBUG_EVENTS.COMMENT_FETCH_RESULT, {
    attempt: 1,
    batchesFetched: 2,
    elapsedMs: 25.5,
    failureCategory: "timeout",
    generation: 3,
    outcome: "partial",
    recordCount: 8,
    resultCount: 2,
    retryable: true,
    videoId: "album_123-ABC",
  });

  assert.deepEqual(plain(result), {
    generation: 3,
    videoId: "album_123-ABC",
    attempt: 1,
    outcome: "partial",
    failureCategory: "timeout",
    retryable: true,
    batchesFetched: 2,
    recordCount: 8,
    resultCount: 2,
    elapsedMs: 25.5,
  });

  const rejected = sanitizeDebugFields(DEBUG_EVENTS.COMMENT_FETCH_RESULT, {
    attempt: 1.5,
    batchesFetched: -1,
    elapsedMs: Number.POSITIVE_INFINITY,
    failureCategory: "timeout-with-secret-token",
    generation: Number.NaN,
    outcome: "private-outcome",
    recordCount: "8",
    retryable: "true",
  });
  assert.deepEqual(plain(rejected), {});
});

test("maps transport details into closed non-sensitive failure categories", async () => {
  const { classifyCommentFetchFailureCategory } = await loadDebug();
  const cases = [
    [{ status: "aborted" }, "aborted"],
    [{ reason: "timeout", status: "transient-error" }, "timeout"],
    [{ reason: "unsafe-continuation-api-url", status: "unsupported" }, "unsafe-endpoint"],
    [{ reason: "stale-watch-page-data", status: "unsupported" }, "stale-page-data"],
    [{ reason: "network-error", status: "transient-error" }, "network-error"],
    [{ reason: "watch-page-http-403", status: "unsupported" }, "http-client"],
    [{ reason: "comment-continuation-http-503", status: "transient-error" }, "http-server"],
    [{ reason: "invalid-continuation-json", status: "unsupported" }, "invalid-response"],
    [{ reason: "missing-innertube-context", status: "unsupported" }, "unsupported"],
    [{ reason: "private-token-shaped-reason", status: "partial" }, "unexpected-rejection"],
    [{ status: "success" }, undefined],
  ];

  for (const [result, expected] of cases) {
    assert.equal(classifyCommentFetchFailureCategory(result), expected);
  }
});

test("accepts every discovery status and reason without enum drift", async () => {
  const { DEBUG_EVENTS, sanitizeDebugFields } = await loadDebug();
  const { DISCOVERY_REASONS, DISCOVERY_STATUSES } = await loadDiscoveryStatus();

  for (const status of Object.values(DISCOVERY_STATUSES)) {
    assert.deepEqual(
      plain(sanitizeDebugFields(DEBUG_EVENTS.DISCOVERY_TRANSITION, { status })),
      { status }
    );
  }
  for (const reason of Object.values(DISCOVERY_REASONS)) {
    assert.deepEqual(
      plain(sanitizeDebugFields(DEBUG_EVENTS.DISCOVERY_TRANSITION, { reason })),
      { reason }
    );
  }
});

test("drops bodies, identities, titles, tokens, URLs, errors, and unsafe enum strings", async () => {
  const { DEBUG_EVENTS, createDebugLogger, sanitizeDebugFields } = await loadDebug();
  let getterRead = false;
  const fields = {
    authorChannelId: "private-channel",
    authorName: "private author",
    body: "private comment body",
    commentId: "private-comment",
    error: new Error("request URL contained a token"),
    failureCategory: "continuation-secret-token",
    headers: { authorization: "secret" },
    outcome: "success",
    reason: "continuation-secret-token",
    records: [{ text: "private" }],
    response: { body: "private" },
    text: "private description text",
    title: "private track title",
    token: "continuation-secret",
    url: "https://example.test/?token=secret",
    videoId: "safe-video_id",
  };
  Object.defineProperty(fields, "status", {
    enumerable: true,
    get() {
      getterRead = true;
      return "ready";
    },
  });

  const sanitized = sanitizeDebugFields(DEBUG_EVENTS.COMMENT_FETCH_RESULT, fields);

  assert.deepEqual(plain(sanitized), {
    videoId: "safe-video_id",
    outcome: "success",
  });
  assert.equal(getterRead, false, "sanitization must not invoke caller-defined getters");

  const calls = [];
  const logger = createDebugLogger({
    isEnabled: () => true,
    sink: (...args) => calls.push(args),
  });
  assert.equal(logger.log(DEBUG_EVENTS.COMMENT_FETCH_RESULT, fields), true);
  assert.deepEqual(plain(calls[0][1]), {
    videoId: "safe-video_id",
    outcome: "success",
  });
});

test("constrains video IDs instead of accepting URL- or token-shaped strings", async () => {
  const { DEBUG_EVENTS, sanitizeDebugFields } = await loadDebug();
  const event = DEBUG_EVENTS.SESSION_STARTED;

  for (const videoId of [
    "https://youtube.com/watch",
    "channel/private",
    "user@example",
    "token:secret",
    "query?token=secret",
    "a".repeat(65),
    "",
  ]) {
    assert.deepEqual(
      plain(sanitizeDebugFields(event, { generation: 1, videoId })),
      { generation: 1 },
      videoId
    );
  }

  assert.deepEqual(
    plain(sanitizeDebugFields(event, {
      generation: 1,
      videoId: "dQw4w9WgXcQ",
    })),
    { generation: 1, videoId: "dQw4w9WgXcQ" }
  );
});

test("contains proxy, opt-in, sanitization, and sink failures", async () => {
  const { DEBUG_EVENTS, createDebugLogger, sanitizeDebugFields } = await loadDebug();
  const throwingFields = new Proxy({}, {
    ownKeys() {
      throw new Error("blocked reflection");
    },
  });

  const sanitized = sanitizeDebugFields(DEBUG_EVENTS.SESSION_STARTED, throwingFields);
  assert.deepEqual(plain(sanitized), {});
  assert.equal(Object.isFrozen(sanitized), true);

  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.deepEqual(
    plain(sanitizeDebugFields(DEBUG_EVENTS.SESSION_STARTED, revoked.proxy)),
    {},
    "even proxy checks such as Array.isArray must be contained"
  );

  const calls = [];
  const logger = createDebugLogger({
    isEnabled: () => true,
    sink: (...args) => calls.push(args),
  });
  assert.equal(logger.log(DEBUG_EVENTS.SESSION_STARTED, throwingFields), true);
  assert.deepEqual(plain(calls[0][1]), {});

  const brokenSink = createDebugLogger({
    isEnabled: () => true,
    sink: () => {
      throw new Error("console unavailable");
    },
  });
  assert.equal(brokenSink.log(DEBUG_EVENTS.RETRY_EXHAUSTED, { attempt: 2 }), false);

  const brokenOptIn = createDebugLogger({
    isEnabled: () => {
      throw new Error("storage blocked");
    },
    sink: () => {
      throw new Error("must not run");
    },
  });
  assert.equal(brokenOptIn.log(DEBUG_EVENTS.SESSION_STARTED), false);
});

test("disabled logging does not inspect caller fields", async () => {
  const { DEBUG_EVENTS, createDebugLogger } = await loadDebug();
  let inspected = false;
  const fields = new Proxy({}, {
    ownKeys() {
      inspected = true;
      throw new Error("must not inspect disabled fields");
    },
  });
  const logger = createDebugLogger({
    isEnabled: () => false,
    sink: () => {
      throw new Error("must not call disabled sink");
    },
  });

  assert.equal(logger.log(DEBUG_EVENTS.SESSION_STARTED, fields), false);
  assert.equal(inspected, false);
});

test("runtime wiring exposes status transitions and diagnostics without legacy phases", async () => {
  const [contentSource, manifestSource, packageSource, testingSource] = await Promise.all([
    readFile(new URL("../src/content.js", import.meta.url), "utf8"),
    readFile(new URL("../manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../TESTING.md", import.meta.url), "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource);
  const packageJson = JSON.parse(packageSource);
  const scripts = manifest.content_scripts[0].js;

  assert.ok(scripts.indexOf("src/debug.js") < scripts.indexOf("src/content.js"));
  assert.ok(
    scripts.indexOf("src/debug.js") < scripts.indexOf("src/session-diagnostics.js")
  );
  assert.ok(
    scripts.indexOf("src/session-diagnostics.js") < scripts.indexOf("src/content.js")
  );
  assert.ok(
    scripts.indexOf("src/discovery-status.js") < scripts.indexOf("src/watch-session.js")
  );
  assert.match(packageJson.scripts["check:js"], /src\/debug\.js/);
  assert.match(packageJson.scripts["check:js"], /src\/session-diagnostics\.js/);
  assert.match(packageJson.scripts["check:js"], /src\/discovery-status\.js/);
  assert.equal(packageJson.scripts["test:debug"], "node --test tests/debug.test.mjs");
  assert.equal(
    packageJson.scripts["test:session-diagnostics"],
    "node --test tests/session-diagnostics.test.mjs"
  );
  assert.equal(
    packageJson.scripts["test:discovery-status"],
    "node --test tests/discovery-status.test.mjs"
  );

  assert.match(contentSource, /createSessionDiagnostics\(\)/);
  assert.match(contentSource, /deriveDiscoveryTarget\(\{/);
  assert.match(contentSource, /transitionDiscoveryState\(/);
  assert.match(contentSource, /diagnostics\.sourceDecision\(/);
  assert.match(contentSource, /diagnostics\.retryExhausted\(/);
  assert.doesNotMatch(contentSource, /session\.phase/);
  assert.doesNotMatch(contentSource, /retries\.readiness|["']readiness["']/);
  assert.doesNotMatch(contentSource, /console\.(?:debug|log|warn|error)/);
  const noVideoBranch = contentSource.match(
    /if \(!video\) \{[\s\S]*?updateUi\(\);\n      return;/
  )?.[0] || "";
  assert.match(noVideoBranch, /resetSessionRetry\(session, "sourceDiscovery"\)/);

  assert.match(testingSource, /sessionStorage\.setItem\("timestamp-player:debug", "1"\)/);
  assert.match(testingSource, /never include comment or description/i);
});
