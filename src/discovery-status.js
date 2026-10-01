(() => {
  const DISCOVERY_STATUSES = Object.freeze({
    EMPTY: "empty",
    PENDING: "pending",
    READY: "ready",
    STOPPED: "stopped",
  });

  const DISCOVERY_REASONS = Object.freeze({
    AD_PLAYING: "ad-playing",
    NO_SUPPORTED_TIMESTAMPS: "no-supported-timestamps",
    PROVISIONAL_SOURCE: "provisional-source",
    SCANNING_SOURCES: "scanning-sources",
    SESSION_ENDED: "session-ended",
    SETTLED_SOURCE: "settled-source",
    SOURCE_OWNERSHIP_UNCONFIRMED: "source-ownership-unconfirmed",
    STARTING: "starting",
    VERIFYING_SOURCE: "verifying-source",
    WAITING_FOR_COMMENT_FETCH: "waiting-for-comment-fetch",
    WAITING_FOR_CHAPTER_FETCH: "waiting-for-chapter-fetch",
    WAITING_FOR_DESCRIPTION: "waiting-for-description",
    WAITING_FOR_DURATION: "waiting-for-duration",
    WAITING_FOR_VIDEO: "waiting-for-video",
    WAITING_FOR_VIDEO_OWNERSHIP: "waiting-for-video-ownership",
  });
  const SOURCE_DISCOVERY_RETRY_ACTIONS = Object.freeze({
    CONFIRM: "confirm",
    NONE: "none",
    RESET: "reset",
    RETRY: "retry",
  });

  const REASONS_BY_STATUS = Object.freeze({
    [DISCOVERY_STATUSES.EMPTY]: new Set([
      DISCOVERY_REASONS.NO_SUPPORTED_TIMESTAMPS,
      DISCOVERY_REASONS.SOURCE_OWNERSHIP_UNCONFIRMED,
    ]),
    [DISCOVERY_STATUSES.PENDING]: new Set([
      DISCOVERY_REASONS.AD_PLAYING,
      DISCOVERY_REASONS.PROVISIONAL_SOURCE,
      DISCOVERY_REASONS.SCANNING_SOURCES,
      DISCOVERY_REASONS.STARTING,
      DISCOVERY_REASONS.VERIFYING_SOURCE,
      DISCOVERY_REASONS.WAITING_FOR_COMMENT_FETCH,
      DISCOVERY_REASONS.WAITING_FOR_CHAPTER_FETCH,
      DISCOVERY_REASONS.WAITING_FOR_DESCRIPTION,
      DISCOVERY_REASONS.WAITING_FOR_DURATION,
      DISCOVERY_REASONS.WAITING_FOR_VIDEO,
      DISCOVERY_REASONS.WAITING_FOR_VIDEO_OWNERSHIP,
    ]),
    [DISCOVERY_STATUSES.READY]: new Set([
      DISCOVERY_REASONS.PROVISIONAL_SOURCE,
      DISCOVERY_REASONS.SETTLED_SOURCE,
    ]),
    [DISCOVERY_STATUSES.STOPPED]: new Set([
      DISCOVERY_REASONS.SESSION_ENDED,
    ]),
  });

  function createDiscoveryState({ now = Date.now() } = {}) {
    return createState(
      DISCOVERY_STATUSES.PENDING,
      DISCOVERY_REASONS.STARTING,
      now
    );
  }

  function transitionDiscoveryState(current, status, reason, { now = Date.now() } = {}) {
    validateDiscoveryState(current);
    validateStatusReason(status, reason);

    if (current.status === DISCOVERY_STATUSES.STOPPED && status !== DISCOVERY_STATUSES.STOPPED) {
      throw new TypeError("Stopped discovery state cannot be restarted");
    }

    if (current.status === status && current.reason === reason) {
      return Object.freeze({
        changed: false,
        current,
        previous: current,
      });
    }

    const next = createState(status, reason, now);
    return Object.freeze({
      changed: true,
      current: next,
      previous: current,
    });
  }

  function deriveDiscoveryTarget({
    adPlaying = false,
    awaitingSourceConfirmation = false,
    commentDiscoveryPending = false,
    chapterDiscoveryPending = false,
    descriptionDiscoveryPending = false,
    hasSelectedSource = false,
    sourceDiscoveryExhausted = false,
    selectedSourceSettled = false,
    waitingForVideoOwnership = false,
  } = {}) {
    if (selectedSourceSettled && !hasSelectedSource) {
      throw new TypeError("A settled source must also be selected");
    }

    if (hasSelectedSource && selectedSourceSettled && !awaitingSourceConfirmation) {
      return createTarget(
        DISCOVERY_STATUSES.READY,
        DISCOVERY_REASONS.SETTLED_SOURCE
      );
    }

    // Media readiness blocks source discovery, but it must not turn a long ad or
    // a still-hydrating watch shell into a false "no timestamps" result. A
    // settled source remains ready across a mid-roll ad via the branch above.
    if (adPlaying) {
      return createTarget(
        DISCOVERY_STATUSES.PENDING,
        DISCOVERY_REASONS.AD_PLAYING
      );
    }
    if (waitingForVideoOwnership) {
      return createTarget(
        DISCOVERY_STATUSES.PENDING,
        DISCOVERY_REASONS.WAITING_FOR_VIDEO_OWNERSHIP
      );
    }

    if (hasSelectedSource) {
      if (sourceDiscoveryExhausted && !commentDiscoveryPending) {
        return createTarget(
          DISCOVERY_STATUSES.READY,
          selectedSourceSettled
            ? DISCOVERY_REASONS.SETTLED_SOURCE
            : DISCOVERY_REASONS.PROVISIONAL_SOURCE
        );
      }

      return createTarget(
        DISCOVERY_STATUSES.PENDING,
        awaitingSourceConfirmation
          ? DISCOVERY_REASONS.VERIFYING_SOURCE
          : DISCOVERY_REASONS.PROVISIONAL_SOURCE
      );
    }

    if (chapterDiscoveryPending) {
      return createTarget(DISCOVERY_STATUSES.PENDING, DISCOVERY_REASONS.WAITING_FOR_CHAPTER_FETCH);
    }
    if (descriptionDiscoveryPending) {
      return createTarget(
        DISCOVERY_STATUSES.PENDING,
        DISCOVERY_REASONS.WAITING_FOR_DESCRIPTION
      );
    }

    if (
      awaitingSourceConfirmation
      && sourceDiscoveryExhausted
      && !commentDiscoveryPending
    ) {
      return createTarget(
        DISCOVERY_STATUSES.EMPTY,
        DISCOVERY_REASONS.SOURCE_OWNERSHIP_UNCONFIRMED
      );
    }

    if (sourceDiscoveryExhausted && !commentDiscoveryPending) {
      return createTarget(
        DISCOVERY_STATUSES.EMPTY,
        DISCOVERY_REASONS.NO_SUPPORTED_TIMESTAMPS
      );
    }

    if (awaitingSourceConfirmation) {
      return createTarget(
        DISCOVERY_STATUSES.PENDING,
        DISCOVERY_REASONS.VERIFYING_SOURCE
      );
    }

    return createTarget(
      DISCOVERY_STATUSES.PENDING,
      commentDiscoveryPending
        ? DISCOVERY_REASONS.WAITING_FOR_COMMENT_FETCH
        : DISCOVERY_REASONS.SCANNING_SOURCES
    );
  }

  function deriveSourceDiscoveryRetryAction({
    allowExhaustedConfirmation = true,
    awaitingSourceConfirmation = false,
    descriptionDiscoveryPending = false,
    selectedSourceSettled = false,
    sourceDiscoveryExhausted = false,
  } = {}) {
    if (
      selectedSourceSettled
      && !awaitingSourceConfirmation
      && !descriptionDiscoveryPending
    ) {
      return SOURCE_DISCOVERY_RETRY_ACTIONS.RESET;
    }
    if (sourceDiscoveryExhausted) {
      return allowExhaustedConfirmation && awaitingSourceConfirmation
        ? SOURCE_DISCOVERY_RETRY_ACTIONS.CONFIRM
        : SOURCE_DISCOVERY_RETRY_ACTIONS.NONE;
    }
    return SOURCE_DISCOVERY_RETRY_ACTIONS.RETRY;
  }

  function validateDiscoveryState(state) {
    if (!state || typeof state !== "object") {
      throw new TypeError("Discovery state is required");
    }
    validateStatusReason(state.status, state.reason);
    validateTimestamp(state.changedAt);
    return state;
  }

  function createState(status, reason, changedAt) {
    validateStatusReason(status, reason);
    validateTimestamp(changedAt);
    return Object.freeze({
      changedAt,
      reason,
      status,
    });
  }

  function createTarget(status, reason) {
    validateStatusReason(status, reason);
    return Object.freeze({ reason, status });
  }

  function validateStatusReason(status, reason) {
    const allowedReasons = REASONS_BY_STATUS[status];
    if (!allowedReasons) {
      throw new TypeError(`Unsupported discovery status: ${status}`);
    }
    if (!allowedReasons.has(reason)) {
      throw new TypeError(`Discovery reason ${reason} is invalid for status ${status}`);
    }
  }

  function validateTimestamp(value) {
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError("Discovery timestamps must be finite non-negative numbers");
    }
  }

  globalThis.TimestampPlayerDiscoveryStatus = {
    DISCOVERY_REASONS,
    DISCOVERY_STATUSES,
    SOURCE_DISCOVERY_RETRY_ACTIONS,
    createDiscoveryState,
    deriveDiscoveryTarget,
    deriveSourceDiscoveryRetryAction,
    transitionDiscoveryState,
    validateDiscoveryState,
  };
})();
