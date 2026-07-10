(() => {
  const {
    DEBUG_EVENTS,
    classifyCommentFetchFailureCategory,
    createDebugLogger,
  } = globalThis.TimestampPlayerDebug;

  function createSessionDiagnostics({
    logger = createDebugLogger(),
    now = Date.now,
  } = {}) {
    if (
      !logger
      || typeof logger.isEnabled !== "function"
      || typeof logger.log !== "function"
    ) {
      throw new TypeError("Session diagnostics require a debug logger");
    }
    if (typeof now !== "function") {
      throw new TypeError("Session diagnostics now must be a function");
    }

    const launcherStates = new WeakMap();
    const videoResolutionStates = new WeakMap();

    function sessionStarted(session) {
      return safeLog(DEBUG_EVENTS.SESSION_STARTED, getSessionFields(session));
    }

    function sessionEnded(session, sessionEndReason) {
      return safeLog(DEBUG_EVENTS.SESSION_ENDED, {
        ...getSessionFields(session),
        sessionEndReason,
      });
    }

    function discoveryTransition(session, transition) {
      if (!transition?.changed) {
        return false;
      }
      return safeLog(DEBUG_EVENTS.DISCOVERY_TRANSITION, {
        ...getSessionFields(session),
        previousStatus: transition.previous.status,
        previousReason: transition.previous.reason,
        status: transition.current.status,
        reason: transition.current.reason,
        elapsedMs: getElapsedMs(session),
      });
    }

    function retryScheduled(session, retryName, { attempt, delayMs }) {
      return safeLog(DEBUG_EVENTS.RETRY_SCHEDULED, {
        ...getSessionFields(session),
        retryName,
        attempt,
        delayMs,
      });
    }

    function retryExhausted(session, retryName, retry) {
      return safeLog(DEBUG_EVENTS.RETRY_EXHAUSTED, {
        ...getSessionFields(session),
        retryName,
        attempt: retry?.attempt,
        elapsedMs: getElapsedMs(session, retry?.startedAt),
        exhausted: true,
      });
    }

    function videoResolution(session, resolution) {
      if (!session || !resolution) {
        return false;
      }
      const resolutionKey = `${resolution.status || ""}:${resolution.reason || ""}`;
      if (
        resolutionKey === ":"
        || videoResolutionStates.get(session) === resolutionKey
      ) {
        return false;
      }

      const logged = safeLog(DEBUG_EVENTS.VIDEO_RESOLUTION, {
        ...getSessionFields(session),
        videoStatus: resolution.status,
        videoReason: resolution.reason,
      });
      if (logged) {
        videoResolutionStates.set(session, resolutionKey);
      }
      return logged;
    }

    function sourceObserved(session, results, {
      candidateCount,
      sourceChannel,
      sourceKind,
    } = {}) {
      if (!safeIsEnabled()) {
        return 0;
      }

      const normalizedResults = Array.isArray(results) ? results : [];
      const sharedFields = {
        ...getSessionFields(session),
        candidateCount,
        observation: session?.trackSelection?.observation,
        resultCount: normalizedResults.length,
      };
      if (!normalizedResults.length) {
        return safeLog(DEBUG_EVENTS.SOURCE_OBSERVED, {
          ...sharedFields,
          sourceChannel,
          sourceKind,
          trackCount: 0,
        }) ? 1 : 0;
      }

      let loggedCount = 0;
      for (const result of normalizedResults) {
        if (safeLog(DEBUG_EVENTS.SOURCE_OBSERVED, {
          ...sharedFields,
          sourceChannel: result?.source?.channel,
          sourceKind: result?.source?.kind,
          trackCount: Array.isArray(result?.tracks) ? result.tracks.length : 0,
          ownershipConfidence: result?.ownership?.confidence,
          settled: result?.status === "settled",
        })) {
          loggedCount += 1;
        }
      }
      return loggedCount;
    }

    function sourceDecision(session, result, fields) {
      if (!safeIsEnabled()) {
        return false;
      }
      return safeLog(DEBUG_EVENTS.SOURCE_DECISION, {
        ...getSessionFields(session),
        ...fields,
        sourceChannel: result?.source?.channel,
        sourceKind: result?.source?.kind,
        trackCount: Array.isArray(result?.tracks) ? result.tracks.length : 0,
      });
    }

    function launcherSync(session, attached) {
      if (!session) {
        return false;
      }
      const retry = session.retries?.launcher;
      const launcherState = `${attached}:${retry?.attempt}:${retry?.exhausted}`;
      if (launcherStates.get(session) === launcherState) {
        return false;
      }

      const logged = safeLog(DEBUG_EVENTS.LAUNCHER_SYNC, {
        ...getSessionFields(session),
        attached,
        attempt: retry?.attempt,
        exhausted: retry?.exhausted,
      });
      if (logged) {
        launcherStates.set(session, launcherState);
      }
      return logged;
    }

    function commentFetchStarted(session) {
      return safeLog(DEBUG_EVENTS.COMMENT_FETCH_STARTED, {
        ...getSessionFields(session),
        attempt: session?.commentDiscovery?.attempt,
      });
    }

    function commentFetchResult(session, result, resultCount) {
      if (!safeIsEnabled()) {
        return false;
      }
      const records = Array.isArray(result?.records) ? result.records : [];
      return safeLog(DEBUG_EVENTS.COMMENT_FETCH_RESULT, {
        ...getSessionFields(session),
        attempt: session?.commentDiscovery?.attempt,
        outcome: result?.status,
        failureCategory: classifyCommentFetchFailureCategory(result),
        retryable: Boolean(result?.retryable),
        batchesFetched: Number.isInteger(result?.batchesFetched)
          ? result.batchesFetched
          : 0,
        recordCount: records.length,
        resultCount,
        elapsedMs: getElapsedMs(
          session,
          session?.commentDiscovery?.attemptStartedAt
        ),
      });
    }

    function getSessionFields(session) {
      return {
        generation: session?.generation,
        videoId: session?.videoId,
      };
    }

    function getElapsedMs(session, since = session?.startedAt) {
      if (!Number.isFinite(since)) {
        return undefined;
      }
      try {
        return Math.max(0, now() - since);
      } catch (_error) {
        return undefined;
      }
    }

    function safeIsEnabled() {
      try {
        return logger.isEnabled() === true;
      } catch (_error) {
        return false;
      }
    }

    function safeLog(event, fields) {
      if (!safeIsEnabled()) {
        return false;
      }
      try {
        return logger.log(event, fields) === true;
      } catch (_error) {
        return false;
      }
    }

    return Object.freeze({
      commentFetchResult,
      commentFetchStarted,
      discoveryTransition,
      launcherSync,
      retryExhausted,
      retryScheduled,
      sessionEnded,
      sessionStarted,
      sourceDecision,
      sourceObserved,
      videoResolution,
    });
  }

  globalThis.TimestampPlayerSessionDiagnostics = {
    createSessionDiagnostics,
  };
})();
