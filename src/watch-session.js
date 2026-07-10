(() => {
  const {
    createTrackSelectionState,
  } = globalThis.TimestampPlayerTrackSelection;
  const COMMENT_DISCOVERY_STATUSES = Object.freeze({
    IDLE: "idle",
    PENDING: "pending",
    RETRY_WAIT: "retry-wait",
    DONE: "done",
  });
  const DEFAULT_RETRY_POLICIES = Object.freeze({
    readiness: Object.freeze({
      delays: Object.freeze([100, 250, 500, 1000, 2000, 3000]),
      maxElapsedMs: 10000,
    }),
    launcher: Object.freeze({
      delays: Object.freeze([100, 250, 500, 1000, 2000, 3000]),
      maxElapsedMs: 10000,
    }),
    commentFetch: Object.freeze({
      delays: Object.freeze([1000]),
      maxElapsedMs: 5000,
    }),
  });

  function createWatchSession({ generation, videoId, now = Date.now() }) {
    if (!Number.isInteger(generation) || generation < 1) {
      throw new TypeError("Watch session generation must be a positive integer");
    }
    if (!videoId) {
      throw new TypeError("Watch session videoId is required");
    }

    return {
      generation,
      videoId,
      phase: "starting",
      media: createSessionMediaState(),
      startedAt: now,
      abortController: new AbortController(),
      tasks: new Map(),
      retries: {
        readiness: createRetryState(),
        launcher: createRetryState(),
        commentFetch: createRetryState(),
      },
      description: {
        fallbackReadyAt: 0,
        expanded: false,
        shouldCollapse: false,
      },
      domSources: {
        ids: new WeakMap(),
        nextId: 1,
      },
      commentDiscovery: {
        outcome: null,
        result: null,
        status: COMMENT_DISCOVERY_STATUSES.IDLE,
      },
      trackSelection: createTrackSelectionState(),
      autoOpenedCompact: false,
      userClosedPanel: false,
    };
  }

  function createRetryState() {
    return {
      attempt: 0,
      startedAt: null,
      exhausted: false,
    };
  }

  function createSessionMediaState() {
    return {
      binding: null,
      closed: false,
      element: null,
      releaseListeners: null,
      resolution: null,
      revision: 0,
    };
  }

  function bindSessionMedia(session, element, releaseListeners = null) {
    if (!element || (typeof element !== "object" && typeof element !== "function")) {
      throw new TypeError("Session media element is required");
    }
    if (releaseListeners !== null && typeof releaseListeners !== "function") {
      throw new TypeError("Session media listener release must be a function");
    }

    if (!isSessionMediaOpen(session)) {
      invokeMediaRelease(releaseListeners);
      return null;
    }

    const { media } = session;
    if (media.element === element && media.releaseListeners === releaseListeners) {
      return media.binding;
    }

    const previousRelease = detachSessionMedia(media);
    const binding = Object.freeze({
      element,
      revision: media.revision + 1,
    });
    media.binding = binding;
    media.element = element;
    media.releaseListeners = releaseListeners;
    media.resolution = null;
    media.revision = binding.revision;
    invokeMediaRelease(previousRelease);
    return binding;
  }

  function clearSessionMedia(session, expectedBinding) {
    const media = session?.media;
    if (!media?.binding) {
      return false;
    }
    if (expectedBinding !== undefined && media.binding !== expectedBinding) {
      return false;
    }

    const releaseListeners = detachSessionMedia(media);
    invokeMediaRelease(releaseListeners);
    return true;
  }

  function isSessionMediaCurrent(session, binding) {
    return Boolean(
      binding
      && isSessionMediaOpen(session)
      && session.media.binding === binding
    );
  }

  function isSessionMediaOpen(session) {
    return Boolean(
      session?.media
      && !session.media.closed
      && !session.abortController?.signal?.aborted
    );
  }

  function detachSessionMedia(media) {
    const releaseListeners = media.releaseListeners;
    media.binding = null;
    media.element = null;
    media.releaseListeners = null;
    media.resolution = null;
    return releaseListeners;
  }

  function invokeMediaRelease(releaseListeners) {
    if (typeof releaseListeners !== "function") {
      return false;
    }
    try {
      releaseListeners();
    } catch (_error) {
      // Listener teardown is best-effort and must not block rebinding or disposal.
    }
    return true;
  }

  function isWatchSessionCurrent(session, {
    activeSession,
    activeVideoId,
    watchPageActive,
  }) {
    return Boolean(
      watchPageActive
      && session
      && session === activeSession
      && !session.abortController.signal.aborted
      && session.videoId === activeVideoId
    );
  }

  function scheduleSessionTask(session, taskName, callback, {
    delay = 0,
    now = Date.now,
    setTimer = globalThis.setTimeout,
    clearTimer = globalThis.clearTimeout,
  } = {}) {
    if (!session || session.abortController.signal.aborted) {
      return false;
    }

    const normalizedDelay = Math.max(0, Number(delay) || 0);
    const dueAt = now() + normalizedDelay;
    const existingTask = session.tasks.get(taskName);
    if (existingTask && existingTask.dueAt <= dueAt) {
      return false;
    }
    if (existingTask) {
      cancelSessionTask(session, taskName);
    }

    const task = {
      clearTimer,
      dueAt,
      timerId: null,
    };
    session.tasks.set(taskName, task);
    task.timerId = setTimer(() => {
      if (session.tasks.get(taskName) !== task) {
        return;
      }

      session.tasks.delete(taskName);
      if (!session.abortController.signal.aborted) {
        callback();
      }
    }, normalizedDelay);
    return true;
  }

  function cancelSessionTask(session, taskName) {
    const task = session?.tasks.get(taskName);
    if (!task) {
      return false;
    }

    session.tasks.delete(taskName);
    if (task.timerId !== null) {
      task.clearTimer(task.timerId);
    }
    return true;
  }

  function scheduleSessionRetry(session, retryName, callback, {
    policy = DEFAULT_RETRY_POLICIES[retryName],
    now = Date.now,
    setTimer = globalThis.setTimeout,
    clearTimer = globalThis.clearTimeout,
  } = {}) {
    const retry = session?.retries[retryName];
    if (!retry || !policy || session.abortController.signal.aborted) {
      return false;
    }
    if (session.tasks.has(`retry:${retryName}`)) {
      return false;
    }

    const currentTime = now();
    if (retry.startedAt === null) {
      retry.startedAt = currentTime;
    }

    const delay = policy.delays[retry.attempt];
    if (
      delay === undefined
      || currentTime - retry.startedAt + delay > policy.maxElapsedMs
    ) {
      retry.exhausted = true;
      return false;
    }

    const scheduled = scheduleSessionTask(session, `retry:${retryName}`, callback, {
      delay,
      now,
      setTimer,
      clearTimer,
    });
    if (scheduled) {
      retry.attempt += 1;
    }
    return scheduled;
  }

  function resetSessionRetry(session, retryName) {
    const retry = session?.retries[retryName];
    if (!retry) {
      return;
    }

    cancelSessionTask(session, `retry:${retryName}`);
    retry.attempt = 0;
    retry.startedAt = null;
    retry.exhausted = false;
  }

  function disposeWatchSession(session, reason = "watch-session-ended") {
    if (!session || session.abortController.signal.aborted) {
      return;
    }

    for (const taskName of [...session.tasks.keys()]) {
      cancelSessionTask(session, taskName);
    }
    session.phase = "stopped";
    session.media.closed = true;
    clearSessionMedia(session);
    session.abortController.abort(reason);
  }

  globalThis.TimestampPlayerWatchSession = {
    COMMENT_DISCOVERY_STATUSES,
    DEFAULT_RETRY_POLICIES,
    bindSessionMedia,
    cancelSessionTask,
    clearSessionMedia,
    createWatchSession,
    disposeWatchSession,
    isSessionMediaCurrent,
    isWatchSessionCurrent,
    resetSessionRetry,
    scheduleSessionRetry,
    scheduleSessionTask,
  };
})();
