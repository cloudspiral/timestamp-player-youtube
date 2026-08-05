(() => {
  const DEBUG_FLAG_KEY = "timestamp-player:debug";
  const DEBUG_PREFIX = "[TimestampPlayer]";
  const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

  const DEBUG_EVENTS = Object.freeze({
    COMMENT_FETCH_RESULT: "comment-fetch.result",
    COMMENT_FETCH_STARTED: "comment-fetch.started",
    DISCOVERY_TRANSITION: "discovery.transition",
    LAUNCHER_SYNC: "launcher.sync",
    RETRY_EXHAUSTED: "retry.exhausted",
    RETRY_SCHEDULED: "retry.scheduled",
    SESSION_ENDED: "session.ended",
    SESSION_STARTED: "session.started",
    SOURCE_DECISION: "source.decision",
    SOURCE_OBSERVED: "source.observed",
    VIDEO_RESOLUTION: "video.resolution",
  });

  const EVENT_FIELDS = Object.freeze({
    [DEBUG_EVENTS.COMMENT_FETCH_RESULT]: Object.freeze([
      "generation",
      "videoId",
      "attempt",
      "outcome",
      "failureCategory",
      "retryable",
      "batchesFetched",
      "recordCount",
      "resultCount",
      "elapsedMs",
    ]),
    [DEBUG_EVENTS.COMMENT_FETCH_STARTED]: Object.freeze([
      "generation",
      "videoId",
      "attempt",
    ]),
    [DEBUG_EVENTS.DISCOVERY_TRANSITION]: Object.freeze([
      "generation",
      "videoId",
      "previousStatus",
      "previousReason",
      "status",
      "reason",
      "elapsedMs",
    ]),
    [DEBUG_EVENTS.LAUNCHER_SYNC]: Object.freeze([
      "generation",
      "videoId",
      "attached",
      "attempt",
      "exhausted",
    ]),
    [DEBUG_EVENTS.RETRY_EXHAUSTED]: Object.freeze([
      "generation",
      "videoId",
      "retryName",
      "attempt",
      "elapsedMs",
      "exhausted",
    ]),
    [DEBUG_EVENTS.RETRY_SCHEDULED]: Object.freeze([
      "generation",
      "videoId",
      "retryName",
      "attempt",
      "delayMs",
    ]),
    [DEBUG_EVENTS.SESSION_ENDED]: Object.freeze([
      "generation",
      "videoId",
      "sessionEndReason",
    ]),
    [DEBUG_EVENTS.SESSION_STARTED]: Object.freeze([
      "generation",
      "videoId",
    ]),
    [DEBUG_EVENTS.SOURCE_DECISION]: Object.freeze([
      "generation",
      "videoId",
      "sourceKind",
      "sourceChannel",
      "accepted",
      "changed",
      "decisionReason",
      "trackCount",
      "awaitingConfirmation",
    ]),
    [DEBUG_EVENTS.SOURCE_OBSERVED]: Object.freeze([
      "generation",
      "videoId",
      "observation",
      "sourceKind",
      "sourceChannel",
      "candidateCount",
      "resultCount",
      "trackCount",
      "ownershipConfidence",
      "settled",
    ]),
    [DEBUG_EVENTS.VIDEO_RESOLUTION]: Object.freeze([
      "generation",
      "videoId",
      "videoStatus",
      "videoReason",
    ]),
  });

  const BOOLEAN_FIELDS = new Set([
    "accepted",
    "attached",
    "awaitingConfirmation",
    "changed",
    "exhausted",
    "retryable",
    "settled",
  ]);
  const INTEGER_FIELDS = new Set([
    "attempt",
    "batchesFetched",
    "candidateCount",
    "generation",
    "observation",
    "recordCount",
    "resultCount",
    "trackCount",
  ]);
  const NUMBER_FIELDS = new Set([
    ...INTEGER_FIELDS,
    "delayMs",
    "elapsedMs",
  ]);

  const DISCOVERY_STATUS_VALUES = new Set([
    "empty",
    "pending",
    "ready",
    "stopped",
  ]);
  const DISCOVERY_REASON_VALUES = new Set([
    "ad-playing",
    "no-supported-timestamps",
    "provisional-source",
    "scanning-sources",
    "session-ended",
    "settled-source",
    "source-ownership-unconfirmed",
    "starting",
    "verifying-source",
    "waiting-for-comment-fetch",
    "waiting-for-description",
    "waiting-for-duration",
    "waiting-for-video",
    "waiting-for-video-ownership",
  ]);
  const ENUM_STRING_FIELDS = Object.freeze({
    decisionReason: new Set([
      "accepted",
      "ineligible",
      "lower-quality",
      "metadata-updated",
      "ownership-pending",
      "same-quality",
      "source-replaced",
      "timing-updated",
      "title-enriched",
      "unchanged",
    ]),
    failureCategory: new Set([
      "aborted",
      "http-client",
      "http-server",
      "invalid-response",
      "network-error",
      "stale-page-data",
      "timeout",
      "unexpected-rejection",
      "unsafe-endpoint",
      "unsupported",
    ]),
    outcome: new Set([
      "aborted",
      "no-results",
      "partial",
      "success",
      "transient-error",
      "unsupported",
    ]),
    ownershipConfidence: new Set([
      "strong",
      "weak",
    ]),
    previousReason: DISCOVERY_REASON_VALUES,
    previousStatus: DISCOVERY_STATUS_VALUES,
    reason: DISCOVERY_REASON_VALUES,
    retryName: new Set([
      "commentFetch",
      "launcher",
      "mediaReadiness",
      "sourceDiscovery",
    ]),
    sessionEndReason: new Set([
      "extension-unloaded",
      "left-watch-route",
      "video-changed",
      "watch-session-ended",
      "watch-video-changed",
    ]),
    sourceChannel: new Set([
      "comment",
      "comment-api",
      "comment-dom",
      "description",
      "description-dom",
      "native",
      "native-dom",
    ]),
    sourceKind: new Set([
      "comment",
      "description",
      "native",
    ]),
    status: DISCOVERY_STATUS_VALUES,
    videoReason: new Set([
      "current-music-player",
      "current-watch-player",
      "main-player-ad-showing",
      "no-eligible-video",
      "video-duration-unavailable",
      "watch-shell-video-id-pending",
      "youtube-music-fallback",
    ]),
    videoStatus: new Set([
      "ad-playing",
      "not-found",
      "ready",
      "waiting-for-duration",
      "waiting-for-ownership",
    ]),
  });
  const EMPTY_FIELDS = Object.freeze({});

  function createDebugLogger({
    isEnabled = isDebugEnabled,
    sink = defaultDebugSink,
  } = {}) {
    if (typeof isEnabled !== "function") {
      throw new TypeError("Debug logger isEnabled must be a function");
    }
    if (typeof sink !== "function") {
      throw new TypeError("Debug logger sink must be a function");
    }

    function log(event, fields = {}) {
      if (!safeIsEnabled(isEnabled) || !isSafeEvent(event)) {
        return false;
      }

      try {
        const safeFields = sanitizeDebugFields(event, fields);
        sink(`${DEBUG_PREFIX} ${event}`, safeFields);
        return true;
      } catch (_error) {
        return false;
      }
    }

    return Object.freeze({
      isEnabled: () => safeIsEnabled(isEnabled),
      log,
    });
  }

  function classifyCommentFetchFailureCategory(result = {}) {
    const outcome = typeof result?.status === "string" ? result.status : "";
    const reason = typeof result?.reason === "string" ? result.reason : "";
    if (reason === "aborted" || outcome === "aborted") {
      return "aborted";
    }
    if (reason === "timeout") {
      return "timeout";
    }
    if (reason === "unsafe-continuation-api-url") {
      return "unsafe-endpoint";
    }
    if (reason === "stale-watch-page-data") {
      return "stale-page-data";
    }
    if (reason === "network-error") {
      return "network-error";
    }

    const httpStatus = Number(reason.match(/-http-(\d+)$/)?.[1]);
    if (Number.isInteger(httpStatus) && httpStatus > 0) {
      return httpStatus >= 500 ? "http-server" : "http-client";
    }
    if (
      reason === "invalid-continuation-json"
      || reason === "unsupported-continuation-response"
    ) {
      return "invalid-response";
    }
    if (outcome === "unsupported") {
      return "unsupported";
    }
    if (reason || outcome === "transient-error" || outcome === "partial") {
      return "unexpected-rejection";
    }
    return undefined;
  }

  function sanitizeDebugFields(event, fields) {
    try {
      const allowedFields = EVENT_FIELDS[event];
      if (!allowedFields || !fields || typeof fields !== "object" || Array.isArray(fields)) {
        return EMPTY_FIELDS;
      }

      const descriptors = Object.getOwnPropertyDescriptors(fields);
      const sanitized = {};
      for (const field of allowedFields) {
        const descriptor = descriptors[field];
        if (!descriptor || !("value" in descriptor)) {
          continue;
        }

        const value = sanitizeFieldValue(field, descriptor.value);
        if (value !== undefined) {
          sanitized[field] = value;
        }
      }
      return Object.freeze(sanitized);
    } catch (_error) {
      return EMPTY_FIELDS;
    }
  }

  function sanitizeFieldValue(field, value) {
    if (BOOLEAN_FIELDS.has(field)) {
      return typeof value === "boolean" ? value : undefined;
    }
    if (NUMBER_FIELDS.has(field)) {
      if (!Number.isFinite(value) || value < 0) {
        return undefined;
      }
      return INTEGER_FIELDS.has(field) && !Number.isInteger(value) ? undefined : value;
    }
    if (field === "videoId") {
      return typeof value === "string" && VIDEO_ID_PATTERN.test(value) ? value : undefined;
    }

    const allowedValues = ENUM_STRING_FIELDS[field];
    return typeof value === "string" && allowedValues?.has(value) ? value : undefined;
  }

  function isSafeEvent(event) {
    return typeof event === "string" && Object.hasOwn(EVENT_FIELDS, event);
  }

  function safeIsEnabled(isEnabled) {
    try {
      return isEnabled() === true;
    } catch (_error) {
      return false;
    }
  }

  function isDebugEnabled() {
    try {
      return globalThis.sessionStorage?.getItem(DEBUG_FLAG_KEY) === "1";
    } catch (_error) {
      return false;
    }
  }

  function defaultDebugSink(label, fields) {
    globalThis.console?.debug?.(label, fields);
  }

  globalThis.TimestampPlayerDebug = {
    DEBUG_EVENTS,
    DEBUG_FLAG_KEY,
    DEBUG_PREFIX,
    classifyCommentFetchFailureCategory,
    createDebugLogger,
    isDebugEnabled,
    sanitizeDebugFields,
  };
})();
