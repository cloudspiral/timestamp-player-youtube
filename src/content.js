(() => {
  const LAUNCHER_ID = "timestamp-player-launcher";
  const SCAN_DELAY_MS = 600;
  const LAUNCHER_SYNC_DELAY_MS = 50;
  const SOURCE_OWNERSHIP_CONFIRMATION_DELAY_MS = 100;
  const DESCRIPTION_EXPAND_FALLBACK_DELAY_MS = 2500;
  const PREVIOUS_RESTART_SECONDS = 3;
  const {
    createSessionDiagnostics,
  } = globalThis.TimestampPlayerSessionDiagnostics;
  const {
    DISCOVERY_REASONS,
    DISCOVERY_STATUSES,
    SOURCE_DISCOVERY_RETRY_ACTIONS,
    deriveDiscoveryTarget,
    deriveSourceDiscoveryRetryAction,
    transitionDiscoveryState,
  } = globalThis.TimestampPlayerDiscoveryStatus;
  const {
    createTrackTitleCache,
    storeSettledTrackTitles,
  } = globalThis.TimestampPlayerDiscoveryCache;
  const {
    formatTimestamp,
    formatTrackLabel,
  } = globalThis.TimestampPlayerTimestamps;
  const {
    createYouTubeDom,
  } = globalThis.TimestampPlayerYouTubeDom;
  const {
    COMPACT_PROGRESS_COLORS,
    COMPACT_PROGRESS_STYLES,
    DEFAULT_SETTINGS,
    PROGRESS_TIME_MODE_VALUES,
    TRACK_HIGHLIGHT_COLORS,
    addSettingsChangeListener,
    loadSettings,
    normalizeSettings,
    saveSettings,
  } = globalThis.TimestampPlayerSettings;
  const {
    createSettingsSyncController,
  } = globalThis.TimestampPlayerSettingsSync;
  const {
    createWatchRouteController,
    getWatchVideoId,
  } = globalThis.TimestampPlayerWatchRoute;
  const {
    OWNERSHIP_CONFIDENCE,
    TRACK_SOURCE_KINDS,
    TRACK_SOURCE_STATUSES,
    beginTrackSelectionObservation,
    considerTrackSource,
    enrichTrackSourceFromCache,
    observeTrackSourceOwnership,
    shouldConsiderNativeSource,
    trackSourceNeedsTitleEnrichment,
    updateTrackSelectionDuration,
  } = globalThis.TimestampPlayerTrackSelection;
  const {
    COMMENT_DISCOVERY_STATUSES,
    DEFAULT_RETRY_POLICIES,
    createWatchSession,
    disposeWatchSession,
    isWatchSessionCurrent,
    resetSessionRetry,
    scheduleSessionRetry,
    scheduleSessionTask,
  } = globalThis.TimestampPlayerWatchSession;
  const {
    createTrackDiscoveryController,
  } = globalThis.TimestampPlayerTrackDiscovery;
  const {
    VIDEO_RESOLUTION_STATUSES,
  } = globalThis.TimestampPlayerVideoResolver;
  const {
    getReadySessionVideo: getBoundReadySessionVideo,
    hasMediaResolutionChanged,
    resolveAndBindSessionMedia,
  } = globalThis.TimestampPlayerSessionMedia;
  const {
    dispatchWatchMutations,
    getPreferredWatchMutationRoot,
    getTrackMutationInterests,
  } = globalThis.TimestampPlayerWatchMutations;
  const {
    createTrackListRenderer,
  } = globalThis.TimestampPlayerTrackListRenderer;
  const {
    PANEL_MODES,
    createPlayerLayoutController,
  } = globalThis.TimestampPlayerPlayerLayout;
  const {
    ROOT_ID: PLAYER_ROOT_ID,
    createPlayerViewController,
  } = globalThis.TimestampPlayerPlayerView;
  const {
    PLAYBACK_BOUNDARY_ACTIONS,
    REPEAT_MODES,
    clearPlaybackOrder,
    createPlaybackState,
    getPlaybackPositionDecision,
    getTrackIndexAtTime,
    recordTrackSelection,
    selectNextTrack,
    selectPreviousTrack,
    toggleRepeat: togglePlaybackRepeat,
    toggleShuffle: togglePlaybackShuffle,
  } = globalThis.TimestampPlayerPlaybackState;

  const state = {
    watchPageActive: false,
    session: null,
    nextSessionGeneration: 0,
    playback: createPlaybackState(),
    panelOpen: false,
    panelMode: PANEL_MODES.ANCHORED,
    anchoredCompact: false,
    settings: { ...DEFAULT_SETTINGS },
    tracks: [],
    currentTrackIndex: -1,
    trackTitleCache: createTrackTitleCache(),
    pageObserver: null,
    pageObserverRoot: null,
  };

  let launcherButton;
  let playerShellRoot = null;
  let watchRouteController = null;
  const diagnostics = createSessionDiagnostics();
  const youtubeDom = createYouTubeDom({ Node, document, location });
  const settingsSync = createSettingsSyncController({
    applySettings: setSettings,
    getSettings: () => state.settings,
    load: loadSettings,
    subscribe: addSettingsChangeListener,
  });
  const trackDiscovery = createTrackDiscoveryController({
    diagnostics,
    isCurrentSession,
    scheduleScan,
    scheduleTrackedSessionRetry,
    youtubeDom,
  });
  const playerLayout = createPlayerLayoutController({
    document,
    window,
    findActionRow: () => youtubeDom.findActionRow(state.session?.videoId || ""),
    findCompactActionAnchor: () => youtubeDom.findCompactActionAnchor(
      state.session?.videoId || ""
    ),
    getLauncherElement: () => launcherButton,
    saveSettings,
  });
  playerLayout.hydrate(state.settings);
  const playerView = createPlayerViewController({
    compactProgressColors: COMPACT_PROGRESS_COLORS,
    compactProgressStyles: COMPACT_PROGRESS_STYLES,
    createTrackListRenderer,
    document,
    formatTimestamp,
    formatTrackLabel,
    handlers: {
      onClose: closePlayer,
      onCompactToggle: toggleAnchoredCompact,
      onCurrentTrackClick: scrollCurrentTrackIntoView,
      onNextTrack: playNextTrack,
      onPanelModeToggle: togglePanelMode,
      onPlayPause: togglePlayPause,
      onPlayerKeyDown: handlePlayerKeyDown,
      onPreviousTrack: playPreviousTrack,
      onProgressInput: handleProgressInput,
      onProgressTimeModeToggle: toggleProgressTimeMode,
      onRepeatToggle: toggleRepeat,
      onShuffleToggle: toggleShuffle,
      onTrackListClick: handleTrackListClick,
    },
    trackHighlightColors: TRACK_HIGHLIGHT_COLORS,
  });

  function init() {
    watchRouteController = createWatchRouteController({
      eventTargets: [document, window],
      getUrl: () => location.href,
      onEnter: activateWatchPage,
      onLeave: deactivateWatchPage,
      onNavigate: handleNavigation,
    });
    watchRouteController.start();
  }

  function activateWatchPage({ previousUrl, videoId }) {
    if (state.watchPageActive) {
      return;
    }

    state.watchPageActive = true;
    ensurePlayerUi();
    settingsSync.start();
    state.pageObserver = new MutationObserver(handlePageMutations);
    bindWatchPageObserver();
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    beginWatchSession(videoId, previousUrl ? SCAN_DELAY_MS : 0);
  }

  function bindWatchPageObserver() {
    const nextRoot = getPreferredWatchMutationRoot(document);
    if (!state.pageObserver || !nextRoot || state.pageObserverRoot === nextRoot) {
      return;
    }

    state.pageObserver.disconnect();
    state.pageObserverRoot = nextRoot;
    state.pageObserver.observe(nextRoot, {
      attributeFilter: [
        "ad-showing",
        "aria-expanded",
        "aria-hidden",
        "class",
        "data-video-id",
        "hidden",
        "inert",
        "style",
        "video-id",
      ],
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
  }

  function deactivateWatchPage() {
    if (!state.watchPageActive) {
      return;
    }

    state.watchPageActive = false;
    state.pageObserver?.disconnect();
    state.pageObserver = null;
    state.pageObserverRoot = null;
    settingsSync.stop();
    endWatchSession("left-watch-route");
    document.removeEventListener("fullscreenchange", handleFullscreenChange);
    document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    removeWatchPageUi();
  }

  function removeWatchPageUi() {
    playerLayout.disconnect();
    playerView.teardown();
    launcherButton?.remove();
    launcherButton = null;
    playerShellRoot = null;
  }

  function ensurePlayerUi() {
    const currentElements = playerView.getElements();
    if (currentElements && !currentElements.root.isConnected) {
      playerLayout.disconnect();
      playerShellRoot = null;
    }

    const elements = playerView.ensure();
    if (elements.root !== playerShellRoot) {
      playerLayout.connect({
        dragHandle: elements.dragHandle,
        resizeHandle: elements.resizeHandle,
        root: elements.root,
      });
      playerShellRoot = elements.root;
      playerView.applySettings(state.settings);
    }
    return elements;
  }

  function setSettings(settings) {
    state.settings = normalizeSettings(settings);
    playerLayout.hydrate(state.settings);
    if (!state.watchPageActive) {
      return;
    }
    ensurePlayerUi();
    playerView.applySettings(state.settings);
    maybeAutoOpenCompact(state.session);
    updateUi();
  }

  function handleNavigation({ videoId }) {
    beginWatchSession(videoId, SCAN_DELAY_MS);
  }

  function beginWatchSession(videoId, initialScanDelay = 0) {
    endWatchSession("watch-video-changed");
    const now = Date.now();
    const session = createWatchSession({
      generation: state.nextSessionGeneration + 1,
      videoId,
      now,
    });
    state.nextSessionGeneration = session.generation;
    session.description.fallbackReadyAt = now + DESCRIPTION_EXPAND_FALLBACK_DELAY_MS;
    state.session = session;
    diagnostics.sessionStarted(session);
    resetSessionViewState();
    // YouTube keeps the previous watch DOM around briefly during soft navigation.
    // Preserve the settling delay there so stale roots cannot immediately lock
    // themselves to the new video generation. A direct document load is ready
    // enough to scan immediately.
    scheduleScan(session, initialScanDelay);
    updateUi();
  }

  function endWatchSession(reason) {
    const session = state.session;
    state.session = null;
    if (session) {
      const discoveryTransition = disposeWatchSession(session, reason);
      diagnostics.discoveryTransition(session, discoveryTransition);
      diagnostics.sessionEnded(session, reason);
    }
    resetSessionViewState();
  }

  function transitionSessionDiscovery(session, status, reason) {
    if (!isCurrentSession(session)) {
      return null;
    }

    const transition = transitionDiscoveryState(
      session.discovery,
      status,
      reason,
      { now: Date.now() }
    );
    session.discovery = transition.current;
    diagnostics.discoveryTransition(session, transition);
    return transition;
  }

  function resetSessionViewState() {
    state.playback = createPlaybackState();
    state.panelOpen = false;
    state.panelMode = PANEL_MODES.ANCHORED;
    state.anchoredCompact = false;
    state.tracks = [];
    state.currentTrackIndex = -1;
  }

  function isCurrentSession(session) {
    return isWatchSessionCurrent(session, {
      activeSession: state.session,
      activeVideoId: getCurrentVideoId(),
      watchPageActive: state.watchPageActive,
    });
  }

  function handlePageMutations(mutations) {
    if (!state.watchPageActive) {
      return;
    }

    bindWatchPageObserver();
    const session = state.session;
    dispatchWatchMutations(mutations, {
      interests: getSessionMutationInterests(session),
      isExtensionNode,
      onDiscovery: () => scheduleMutationDiscoveryScan(session),
      onLauncher: () => scheduleLauncherSync(session),
      onMedia: () => scheduleMediaRefresh(session),
    });
  }

  function scheduleMutationDiscoveryScan(session) {
    if (!isCurrentSession(session)) {
      return false;
    }

    // A relevant mutation is allowed one coalesced evidence scan. Exhausted
    // retries stay exhausted until that scan proves a weak-owned source needs
    // exactly one follow-up ownership observation.
    return scheduleScan(session);
  }

  function getSessionMutationInterests(session) {
    const selectedResult = session?.trackSelection.current;
    return getTrackMutationInterests({
      needsTitleEnrichment: trackSourceNeedsTitleEnrichment(selectedResult),
      settled: selectedResult?.status === TRACK_SOURCE_STATUSES.SETTLED,
      sourceKind: selectedResult?.source.kind || "",
    });
  }

  function isExtensionNode(node) {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    return Boolean(
      element
      && (
        playerLayout.ownsNode(element)
        || element === launcherButton
        || launcherButton?.contains(element)
      )
    );
  }

  function scheduleScan(session, delay = SCAN_DELAY_MS) {
    if (!isCurrentSession(session)) {
      return false;
    }

    return scheduleSessionTask(session, "scan", () => scanPage(session), { delay });
  }

  function scheduleMediaRefresh(session, delay = 0) {
    if (!isCurrentSession(session)) {
      return false;
    }

    return scheduleSessionTask(
      session,
      "media-refresh",
      () => refreshSessionMedia(session),
      { delay }
    );
  }

  function scheduleLauncherSync(session, delay = LAUNCHER_SYNC_DELAY_MS) {
    if (!isCurrentSession(session)) {
      return false;
    }

    return scheduleSessionTask(
      session,
      "launcher-sync",
      () => syncLauncherForSession(session),
      { delay }
    );
  }

  function scheduleTrackedSessionRetry(session, retryName, callback) {
    if (!isCurrentSession(session)) {
      return false;
    }

    const retry = session.retries[retryName];
    const policy = DEFAULT_RETRY_POLICIES[retryName];
    if (!retry || !policy) {
      return false;
    }

    const attemptIndex = retry.attempt;
    const wasExhausted = retry.exhausted;
    const scheduled = scheduleSessionRetry(
      session,
      retryName,
      callback
    );
    if (scheduled) {
      diagnostics.retryScheduled(session, retryName, {
        attempt: retry.attempt,
        delayMs: policy.delays[attemptIndex],
      });
    } else if (!wasExhausted && retry.exhausted) {
      diagnostics.retryExhausted(session, retryName, retry);
    }
    return scheduled;
  }

  function scheduleMediaReadinessRetry(session) {
    return scheduleTrackedSessionRetry(
      session,
      "mediaReadiness",
      () => scanPage(session)
    );
  }

  function scheduleSourceDiscoveryRetry(session) {
    return scheduleTrackedSessionRetry(
      session,
      "sourceDiscovery",
      () => scanPage(session)
    );
  }

  function scheduleSourceOwnershipConfirmation(session) {
    if (
      !isCurrentSession(session)
      || !session.retries.sourceDiscovery.exhausted
    ) {
      return false;
    }

    return scheduleSessionTask(
      session,
      "scan",
      () => scanPage(session, { allowExhaustedConfirmation: false }),
      { delay: SOURCE_OWNERSHIP_CONFIRMATION_DELAY_MS }
    );
  }

  function resolveSessionMedia(session) {
    if (!isCurrentSession(session)) {
      return null;
    }

    const resolution = resolveAndBindSessionMedia(session, {
      hostname: location.hostname,
      onEvent: handleSessionMediaEvent,
      root: document,
      videoId: session.videoId,
    });
    diagnostics.videoResolution(session, resolution);
    return resolution;
  }

  function refreshSessionMedia(session) {
    if (!isCurrentSession(session)) {
      return;
    }

    const previousResolution = session.media.resolution;
    const resolution = resolveSessionMedia(session);
    if (!resolution || !isCurrentSession(session)) {
      return;
    }

    const mediaChanged = hasMediaResolutionChanged(previousResolution, resolution);
    if (!mediaChanged) {
      return;
    }
    if (resolution.status === VIDEO_RESOLUTION_STATUSES.READY) {
      synchronizeTrackSelectionDuration(session, resolution.element?.duration);
      resetSessionRetry(session, "mediaReadiness");
      scheduleScan(session, 0);
    } else {
      resetSessionRetry(session, "sourceDiscovery");
      transitionToMediaDiscoveryState(session, resolution.status);
      if (resolution.status !== VIDEO_RESOLUTION_STATUSES.AD_PLAYING) {
        scheduleMediaReadinessRetry(session);
      }
    }
    updateUi();
  }

  function getMediaDiscoveryReason(status) {
    if (status === VIDEO_RESOLUTION_STATUSES.AD_PLAYING) {
      return DISCOVERY_REASONS.AD_PLAYING;
    }
    if (status === VIDEO_RESOLUTION_STATUSES.WAITING_FOR_DURATION) {
      return DISCOVERY_REASONS.WAITING_FOR_DURATION;
    }
    if (status === VIDEO_RESOLUTION_STATUSES.WAITING_FOR_OWNERSHIP) {
      return DISCOVERY_REASONS.WAITING_FOR_VIDEO_OWNERSHIP;
    }
    return DISCOVERY_REASONS.WAITING_FOR_VIDEO;
  }

  function transitionToMediaDiscoveryState(session, status) {
    const selectedResult = session.trackSelection.current;
    if (selectedResult?.status === TRACK_SOURCE_STATUSES.SETTLED) {
      return transitionSessionDiscovery(
        session,
        DISCOVERY_STATUSES.READY,
        DISCOVERY_REASONS.SETTLED_SOURCE
      );
    }
    return transitionSessionDiscovery(
      session,
      DISCOVERY_STATUSES.PENDING,
      getMediaDiscoveryReason(status)
    );
  }

  function scanPage(session, { allowExhaustedConfirmation = true } = {}) {
    if (!isCurrentSession(session)) {
      return;
    }

    bindWatchPageObserver();

    const resolution = resolveSessionMedia(session);
    const video = getReadySessionVideo(session);
    const videoId = session.videoId;

    if (!video) {
      resetSessionRetry(session, "sourceDiscovery");
      transitionToMediaDiscoveryState(session, resolution?.status);
      if (resolution?.status !== VIDEO_RESOLUTION_STATUSES.AD_PLAYING) {
        scheduleMediaReadinessRetry(session);
      }
      updateUi();
      return;
    }

    const duration = Number(video.duration);
    resetSessionRetry(session, "mediaReadiness");
    synchronizeTrackSelectionDuration(session, duration);
    if (session.discovery.status !== DISCOVERY_STATUSES.READY) {
      transitionSessionDiscovery(
        session,
        DISCOVERY_STATUSES.PENDING,
        DISCOVERY_REASONS.SCANNING_SOURCES
      );
    }
    const observation = beginTrackSelectionObservation(session.trackSelection);
    let awaitingSourceConfirmation = false;
    let descriptionDiscoveryPending = false;
    const descriptionDiscovery = trackDiscovery.getDescriptionSourceResults(
      session,
      duration,
      observation
    );
    awaitingSourceConfirmation = considerTrackSourceResults(
      session,
      descriptionDiscovery.results,
      {
        candidateCount: descriptionDiscovery.candidateCount,
        sourceChannel: "description-dom",
        sourceKind: TRACK_SOURCE_KINDS.DESCRIPTION,
      }
    )
      || awaitingSourceConfirmation;
    const descriptionSelected = selectedSourceKind(session) === TRACK_SOURCE_KINDS.DESCRIPTION;

    const descriptionNeedsHydration = (
      !descriptionSelected
      && descriptionDiscovery.results.length === 0
    );
    if (descriptionNeedsHydration) {
      descriptionDiscoveryPending = true;
      if (!shouldWaitForQuietDescriptionScan(session)) {
        expandDescriptionIfAvailable(session);
      }
    }

    const shouldDiscoverAlternativeSources = !descriptionSelected
      || trackSourceNeedsTitleEnrichment(session.trackSelection.current);
    if (shouldDiscoverAlternativeSources) {
      const commentStatus = session.commentDiscovery.status === COMMENT_DISCOVERY_STATUSES.DONE
        ? TRACK_SOURCE_STATUSES.SETTLED
        : TRACK_SOURCE_STATUSES.PROVISIONAL;
      const domCommentDiscovery = trackDiscovery.getDomCommentSourceResults(
        session,
        duration,
        observation,
        commentStatus
      );
      awaitingSourceConfirmation = considerTrackSourceResults(
        session,
        domCommentDiscovery.results,
        {
          candidateCount: domCommentDiscovery.candidateCount,
          sourceChannel: "comment-dom",
          sourceKind: TRACK_SOURCE_KINDS.COMMENT,
        }
      ) || awaitingSourceConfirmation;
      const fetchedCommentDiscovery = trackDiscovery.getFetchedCommentDiscoveryForSession(
        session,
        duration
      );
      if (fetchedCommentDiscovery.result) {
        awaitingSourceConfirmation = considerTrackSourceResults(
          session,
          [fetchedCommentDiscovery.result],
          {
            sourceChannel: "comment-api",
            sourceKind: TRACK_SOURCE_KINDS.COMMENT,
          }
        ) || awaitingSourceConfirmation;
      }
    }

    if (shouldConsiderNativeSource(session.trackSelection)) {
      const nativeDiscovery = trackDiscovery.getNativeSourceDiscovery(
        session,
        duration,
        observation
      );
      awaitingSourceConfirmation = considerTrackSourceResults(
        session,
        nativeDiscovery.result ? [nativeDiscovery.result] : [],
        {
          candidateCount: nativeDiscovery.candidateCount,
          sourceChannel: "native-dom",
          sourceKind: TRACK_SOURCE_KINDS.NATIVE,
        }
      ) || awaitingSourceConfirmation;
    }

    const selectedResult = session.trackSelection.current;
    const sourceRetryAction = deriveSourceDiscoveryRetryAction({
      allowExhaustedConfirmation,
      awaitingSourceConfirmation,
      descriptionDiscoveryPending,
      selectedSourceSettled: selectedResult?.status === TRACK_SOURCE_STATUSES.SETTLED,
      sourceDiscoveryExhausted: session.retries.sourceDiscovery.exhausted,
    });
    if (sourceRetryAction === SOURCE_DISCOVERY_RETRY_ACTIONS.RESET) {
      resetSessionRetry(session, "sourceDiscovery");
    } else if (sourceRetryAction === SOURCE_DISCOVERY_RETRY_ACTIONS.RETRY) {
      scheduleSourceDiscoveryRetry(session);
    } else if (sourceRetryAction === SOURCE_DISCOVERY_RETRY_ACTIONS.CONFIRM) {
      scheduleSourceOwnershipConfirmation(session);
    }
    const sourceDiscoveryExhaustedForStatus = (
      session.retries.sourceDiscovery.exhausted
      && sourceRetryAction !== SOURCE_DISCOVERY_RETRY_ACTIONS.CONFIRM
    );
    descriptionDiscoveryPending = descriptionDiscoveryPending
      && !sourceDiscoveryExhaustedForStatus;

    const discoveryTarget = deriveDiscoveryTarget({
      awaitingSourceConfirmation,
      commentDiscoveryPending: trackDiscovery.isCommentDiscoveryPending(session),
      descriptionDiscoveryPending,
      hasSelectedSource: Boolean(selectedResult),
      selectedSourceSettled: selectedResult?.status === TRACK_SOURCE_STATUSES.SETTLED,
      sourceDiscoveryExhausted: sourceDiscoveryExhaustedForStatus,
    });
    transitionSessionDiscovery(
      session,
      discoveryTarget.status,
      discoveryTarget.reason
    );

    if (!isCurrentSession(session)) {
      return;
    }

    applySelectedTracksForSession(session, video);
    maybeAutoOpenCompact(session);
    if (!descriptionDiscoveryPending) {
      collapseDescriptionIfNeeded(session);
    }
    updateUi();
  }

  function maybeAutoOpenCompact(session = state.session) {
    if (
      !isCurrentSession(session)
      || !state.settings.autoShowCompact
      || state.panelOpen
      || !tracksBelongToVideo(session.videoId)
      || session.trackSelection.current?.status !== TRACK_SOURCE_STATUSES.SETTLED
      || session.autoOpenedCompact
      || session.userClosedPanel
    ) {
      return;
    }

    state.panelOpen = true;
    state.panelMode = PANEL_MODES.ANCHORED;
    state.anchoredCompact = true;
    session.autoOpenedCompact = true;
  }

  function tracksBelongToVideo(videoId = getCurrentVideoId()) {
    const session = state.session;
    return state.tracks.length >= 2
      && isCurrentSession(session)
      && session.videoId === videoId;
  }

  function considerTrackSourceResults(session, results, {
    candidateCount,
    sourceChannel,
    sourceKind,
  } = {}) {
    let awaitingOwnershipConfirmation = false;
    const cachedTitles = state.trackTitleCache.get(session.videoId);
    diagnostics.sourceObserved(session, results, {
      candidateCount,
      sourceChannel,
      sourceKind,
    });
    for (const result of results) {
      const ownedResult = observeTrackSourceOwnership(session.trackSelection, result);
      if (!ownedResult) {
        const ownershipPending = result.ownership.confidence === OWNERSHIP_CONFIDENCE.WEAK;
        awaitingOwnershipConfirmation = awaitingOwnershipConfirmation || ownershipPending;
        if (ownershipPending) {
          diagnostics.sourceDecision(session, result, {
            accepted: false,
            awaitingConfirmation: true,
            changed: false,
            decisionReason: "ownership-pending",
          });
        }
        continue;
      }

      const enrichedResult = enrichTrackSourceFromCache(
        ownedResult,
        cachedTitles
      );
      const previous = session.trackSelection.current;
      const change = considerTrackSource(session.trackSelection, enrichedResult, {
        duration: session.trackSelection.duration,
        generation: session.generation,
        videoId: session.videoId,
      });
      if (change.changed || !change.accepted) {
        diagnostics.sourceDecision(
          session,
          change.accepted ? change.current || enrichedResult : enrichedResult,
          {
            accepted: change.accepted,
            awaitingConfirmation: false,
            changed: change.changed,
            decisionReason: getSourceDecisionReason(change, previous),
          }
        );
      }
    }
    return awaitingOwnershipConfirmation;
  }

  function synchronizeTrackSelectionDuration(session, duration) {
    if (
      !isCurrentSession(session)
      || !updateTrackSelectionDuration(session.trackSelection, duration)
    ) {
      return false;
    }

    resetSessionRetry(session, "sourceDiscovery");
    state.playback = clearPlaybackOrder(state.playback);
    state.tracks = [];
    state.currentTrackIndex = -1;
    return true;
  }

  function getSourceDecisionReason(change, previous) {
    if (!change.accepted) {
      return change.reason || "ineligible";
    }
    if (!previous) {
      return "accepted";
    }
    if (change.sourceReplaced) {
      return "source-replaced";
    }
    if (change.timingsChanged) {
      return "timing-updated";
    }
    if (change.titlesChanged) {
      return "title-enriched";
    }
    if (change.metadataChanged) {
      return "metadata-updated";
    }
    return "unchanged";
  }

  function selectedSourceKind(session) {
    return session.trackSelection.current?.source.kind || null;
  }

  function applySelectedTracksForSession(session, video) {
    if (!isCurrentSession(session)) {
      return;
    }

    const selectedResult = session.trackSelection.current;
    const tracks = selectedResult?.tracks || [];
    if (trackTimingsChanged(state.tracks, tracks)) {
      state.playback = clearPlaybackOrder(state.playback);
    }
    state.tracks = tracks;
    storeSettledTrackTitles(state.trackTitleCache, selectedResult);
    state.currentTrackIndex = getTrackAtTime(video.currentTime)?.index ?? -1;
  }

  function trackTimingsChanged(previousTracks, nextTracks) {
    if (previousTracks.length !== nextTracks.length) {
      return true;
    }

    return previousTracks.some((track, index) => {
      return track.start !== nextTracks[index]?.start || track.end !== nextTracks[index]?.end;
    });
  }

  function getReadySessionVideo(session = state.session) {
    if (!isCurrentSession(session)) {
      return null;
    }
    return getBoundReadySessionVideo(session);
  }

  function areMediaControlsEnabled(session = state.session) {
    return Boolean(
      getReadySessionVideo(session)
      && tracksBelongToVideo(session?.videoId)
    );
  }

  function getCurrentVideoId() {
    return getWatchVideoId(location.href);
  }

  function shouldWaitForQuietDescriptionScan(session) {
    return Date.now() < session.description.fallbackReadyAt;
  }

  function expandDescriptionIfAvailable(session) {
    if (session.description.expanded) {
      return false;
    }

    const expandButton = youtubeDom.findDescriptionExpandButton(session.videoId);
    if (!expandButton) {
      return false;
    }

    // Expansion starts a new hydration phase. Restore a complete bounded
    // discovery budget before clicking so this same scan cannot treat the old
    // exhausted cycle as final and immediately collapse the description.
    resetSessionRetry(session, "sourceDiscovery");
    session.description.expanded = true;
    session.description.shouldCollapse = true;
    expandButton.click();
    return true;
  }

  function collapseDescriptionIfNeeded(session) {
    if (!session.description.shouldCollapse) {
      return;
    }

    const collapseButton = youtubeDom.findDescriptionCollapseButton(session.videoId);
    if (!collapseButton) {
      return;
    }

    session.description.shouldCollapse = false;
    collapseButton.click();
  }

  function syncLauncher(tracksAvailable) {
    if (!tracksAvailable) {
      ensurePlayerUi();
      playerLayout.resetMount();
      launcherButton?.remove();
      return true;
    }

    ensureLauncherButton();
    const actionRow = youtubeDom.findActionRow(state.session?.videoId || "");
    if (!actionRow) {
      return false;
    }

    if (!actionRow.contains(launcherButton)) {
      youtubeDom.insertLauncherButton(actionRow, launcherButton);
    }

    const expanded = isPlayerPanelVisible(tracksAvailable);
    launcherButton.classList.toggle("is-active", expanded);
    launcherButton.setAttribute("aria-expanded", String(expanded));
    return true;
  }

  function isPlayerPanelVisible(tracksAvailable = tracksBelongToVideo()) {
    const hiddenByFullscreen = isFullscreenActive()
      && state.panelMode === PANEL_MODES.ANCHORED;
    return Boolean(tracksAvailable && state.panelOpen && !hiddenByFullscreen);
  }

  function syncLauncherForSession(
    session,
    tracksAvailable = tracksBelongToVideo(session?.videoId),
    { restorePlayer = true } = {}
  ) {
    if (!isCurrentSession(session)) {
      return false;
    }

    const launcherSynced = syncLauncher(tracksAvailable);
    const launcherAttached = isLauncherAttached(session, tracksAvailable);
    syncLauncherRetry(session, tracksAvailable, launcherAttached);
    diagnostics.launcherSync(session, launcherAttached);
    if (launcherSynced && restorePlayer) {
      restorePlayerAfterLauncherSync(tracksAvailable);
    }
    return launcherSynced;
  }

  function isLauncherAttached(session, tracksAvailable) {
    if (!tracksAvailable || !launcherButton?.isConnected) {
      return false;
    }
    const actionRow = youtubeDom.findActionRow(session.videoId);
    return Boolean(actionRow?.contains(launcherButton));
  }

  function restorePlayerAfterLauncherSync(tracksAvailable) {
    const isVisible = isPlayerPanelVisible(tracksAvailable);
    if (!isVisible) {
      return;
    }

    ensurePlayerUi();
    const inlineCompact = state.panelMode === PANEL_MODES.ANCHORED && state.anchoredCompact;
    const mountedInlineCompact = playerLayout.prepareMount({ inlineCompact });
    const video = getReadySessionVideo();
    renderPlayerView({
      controlsEnabled: Boolean(video && tracksAvailable),
      inlineCompact: mountedInlineCompact,
      tracksAvailable,
      video,
      visible: true,
    });
    playerLayout.layoutNow({
      anchoredCompact: state.anchoredCompact,
      inlineCompact: mountedInlineCompact,
      panelMode: state.panelMode,
      visible: true,
    });
  }

  function syncLauncherRetry(session, tracksAvailable, launcherAttached) {
    if (!tracksAvailable || launcherAttached) {
      resetSessionRetry(session, "launcher");
      return;
    }

    scheduleTrackedSessionRetry(session, "launcher", () => {
      if (isCurrentSession(session)) {
        syncLauncherForSession(session);
      }
    });
  }

  function ensureLauncherButton() {
    if (launcherButton) {
      return;
    }

    launcherButton = document.createElement("button");
    launcherButton.id = LAUNCHER_ID;
    launcherButton.type = "button";
    launcherButton.className = "ts-launcher-button";
    launcherButton.setAttribute("aria-controls", PLAYER_ROOT_ID);
    launcherButton.setAttribute("aria-expanded", "false");
    launcherButton.setAttribute("aria-label", "Timestamp player tracklist");
    launcherButton.title = "Toggle timestamp player tracklist";
    launcherButton.innerHTML = `
      <svg class="ts-launcher-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 6h10"></path>
        <path d="M4 12h8"></path>
        <path d="M4 18h6"></path>
        <path d="M17 6v8.4a2.4 2.4 0 1 1-1.6-2.3V6h4"></path>
      </svg>
      <span>Tracklist</span>
    `;
    launcherButton.addEventListener("click", togglePlayerOpen);
  }

  function closePlayer() {
    const playerRoot = playerView.getElements()?.root;
    const restoreLauncherFocus = Boolean(
      playerRoot
      && document.activeElement
      && playerRoot.contains(document.activeElement)
    );
    state.panelOpen = false;
    if (state.session) {
      state.session.userClosedPanel = true;
    }
    updateUi();
    if (restoreLauncherFocus && launcherButton?.isConnected) {
      launcherButton.focus({ preventScroll: true });
    }
  }

  function handlePlayerKeyDown(event) {
    if (
      event.key !== "Escape"
      || event.defaultPrevented
      || !state.panelOpen
    ) {
      return;
    }

    const playerRoot = playerView.getElements()?.root;
    if (!playerRoot?.contains(event.target)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    closePlayer();
  }

  function togglePlayerOpen() {
    if (state.panelOpen) {
      closePlayer();
      return;
    }

    state.panelOpen = true;
    if (state.session) {
      state.session.userClosedPanel = false;
    }
    updateUi();
    if (isPlayerPanelVisible()) {
      playerView.focusOpenControl({
        floating: state.panelMode === PANEL_MODES.FLOATING,
      });
    }
  }

  function togglePanelMode() {
    if (!state.panelOpen) {
      return;
    }

    if (state.panelMode === PANEL_MODES.ANCHORED) {
      playerLayout.ensureFloatingPositionFromCurrentRect();
      state.panelMode = PANEL_MODES.FLOATING;
    } else {
      state.panelMode = PANEL_MODES.ANCHORED;
    }

    updateUi();
  }

  function toggleAnchoredCompact() {
    if (!state.panelOpen || state.panelMode !== PANEL_MODES.ANCHORED) {
      return;
    }

    state.anchoredCompact = !state.anchoredCompact;
    updateUi();
  }

  function togglePlayPause() {
    const video = getReadySessionVideo();
    if (!video || !tracksBelongToVideo()) {
      updateUi();
      return;
    }

    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
    updateUi();
  }

  function toggleShuffle() {
    if (!areMediaControlsEnabled()) {
      updateUi();
      return;
    }
    state.playback = togglePlaybackShuffle(state.playback, state.tracks.length);
    updateUi();
  }

  function toggleRepeat() {
    if (!areMediaControlsEnabled()) {
      updateUi();
      return;
    }
    state.playback = togglePlaybackRepeat(state.playback, state.tracks.length);
    updateUi();
  }

  function toggleProgressTimeMode(event) {
    event.preventDefault();
    const progressTimeMode =
      state.settings.progressTimeMode === PROGRESS_TIME_MODE_VALUES.REMAINING
        ? PROGRESS_TIME_MODE_VALUES.DURATION
        : PROGRESS_TIME_MODE_VALUES.REMAINING;
    state.settings = { ...state.settings, progressTimeMode };
    saveSettings({ progressTimeMode });
    updateProgress();
  }

  function playNextTrack(options = {}) {
    const video = getReadySessionVideo();
    if (!video || !tracksBelongToVideo()) {
      updateUi();
      return;
    }

    const currentIndex = state.playback.shuffleEnabled && options.currentIndex !== undefined
      ? options.currentIndex
      : getCurrentTrackIndexForVideo(video);
    const selection = selectNextTrack(state.playback, {
      currentIndex,
      random: Math.random,
      trackCount: state.tracks.length,
      tracksAvailable: tracksBelongToVideo(),
    });
    state.playback = selection.state;
    playTrack(selection.index, { previousIndex: options.previousIndex });
  }

  function playPreviousTrack() {
    const video = getReadySessionVideo();
    if (!video || !state.tracks.length || !tracksBelongToVideo()) {
      updateUi();
      return;
    }

    const currentIndex = getCurrentTrackIndexForVideo(video);
    if (!isValidTrackIndex(currentIndex)) {
      playTrack(0, { recordHistory: false });
      return;
    }

    const currentTrack = state.tracks[currentIndex];
    if (video.currentTime - currentTrack.start > PREVIOUS_RESTART_SECONDS) {
      playTrack(currentIndex, { recordHistory: false });
      return;
    }

    const selection = selectPreviousTrack(state.playback, {
      currentIndex,
      trackCount: state.tracks.length,
      tracksAvailable: tracksBelongToVideo(),
    });
    state.playback = selection.state;
    playTrack(selection.index, { recordHistory: false });
  }

  function playTrack(index, options = {}) {
    const { recordHistory = true } = options;
    const video = getReadySessionVideo();
    const track = state.tracks[index];
    if (!video || !track || !tracksBelongToVideo()) {
      updateUi();
      return;
    }

    const previousIndex = options.previousIndex ?? getCurrentTrackIndexForVideo(video);
    state.playback = recordTrackSelection(state.playback, {
      nextIndex: index,
      previousIndex,
      recordHistory,
      trackCount: state.tracks.length,
    });
    state.currentTrackIndex = index;
    video.currentTime = track.start;
    video.play().catch(() => {});
    updateUi();
  }

  function getEffectiveCurrentTrackIndex() {
    const video = getReadySessionVideo();
    if (!video) {
      return state.currentTrackIndex;
    }

    return getCurrentTrackIndexForVideo(video);
  }

  function getCurrentTrackIndexForVideo(video) {
    return getTrackAtTime(video.currentTime)?.index ?? state.currentTrackIndex;
  }

  function isValidTrackIndex(index) {
    return Number.isInteger(index) && index >= 0 && index < state.tracks.length;
  }

  function handleProgressInput(event) {
    const slider = event.currentTarget;
    const video = getReadySessionVideo();
    const track = getProgressTrack(video);
    if (!video || !track || slider.disabled || !areMediaControlsEnabled()) {
      updateProgress(video);
      return;
    }

    const duration = getTrackDuration(track);
    const elapsed = Number(slider.value);
    if (!Number.isFinite(elapsed)) {
      updateProgress(video);
      return;
    }
    video.currentTime = track.start + clamp(elapsed, 0, duration);
    state.currentTrackIndex = track.index;
    updateProgress(video);
  }

  function handleSessionMediaEvent({ binding, event, session, video }) {
    if (
      !isCurrentSession(session)
      || session.media.binding !== binding
    ) {
      return;
    }

    if (
      event.type === "loadedmetadata"
      || event.type === "durationchange"
      || event.type === "emptied"
    ) {
      scheduleMediaRefresh(session);
      return;
    }

    if (getReadySessionVideo(session) !== video) {
      return;
    }

    if (event.type === "seeking" || event.type === "seeked") {
      handlePlaybackPosition(video, session, { seekTransition: true });
      return;
    }

    if (event.type === "timeupdate" || event.type === "ended") {
      handlePlaybackPosition(video, session, {
        playbackEnded: event.type === "ended",
      });
      return;
    }

    if (event.type === "play" || event.type === "pause") {
      updateUi();
    }
  }

  function handlePlaybackPosition(video, session = state.session, {
    playbackEnded = false,
    seekTransition = false,
  } = {}) {
    if (
      !isCurrentSession(session)
      || video !== getReadySessionVideo(session)
    ) {
      return;
    }

    if (!tracksBelongToVideo(session.videoId)) {
      updateUi();
      return;
    }

    const seeking = seekTransition || session.media.seeking;
    const decision = getPlaybackPositionDecision(state.playback, {
      activeTrackIndex: state.currentTrackIndex,
      currentTime: video.currentTime,
      seeking,
      tracks: state.tracks,
    });
    if (decision.boundaryAction === PLAYBACK_BOUNDARY_ACTIONS.REPEAT_ONE) {
      playTrack(state.currentTrackIndex, { recordHistory: false });
      return;
    }
    if (decision.boundaryAction === PLAYBACK_BOUNDARY_ACTIONS.SHUFFLE_NEXT) {
      playNextTrack({
        currentIndex: state.currentTrackIndex,
        previousIndex: state.currentTrackIndex,
      });
      return;
    }

    let nextTrackIndex = state.currentTrackIndex;
    if (decision.trackIndex >= 0) {
      nextTrackIndex = decision.trackIndex;
    } else if (seeking) {
      nextTrackIndex = -1;
    }
    if (nextTrackIndex !== state.currentTrackIndex) {
      state.currentTrackIndex = nextTrackIndex;
      updateUi();
      return;
    }

    if (playbackEnded) {
      updateUi();
    } else {
      updateProgress(video);
    }
  }

  function handleFullscreenChange() {
    updateUi();
    playerLayout.schedule();
  }

  function isFullscreenActive() {
    return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function getTrackAtTime(time) {
    if (!tracksBelongToVideo()) {
      return null;
    }

    const trackIndex = getTrackIndexAtTime(state.tracks, time);
    return trackIndex >= 0 ? state.tracks[trackIndex] : null;
  }

  function getProgressTrack(video) {
    if (!video || !tracksBelongToVideo()) {
      return null;
    }

    return state.tracks[state.currentTrackIndex] || getTrackAtTime(video.currentTime);
  }

  function getTrackDuration(track) {
    return Math.max(0, track.end - track.start);
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function handleTrackListClick(event) {
    if (!areMediaControlsEnabled()) {
      return;
    }

    const item = event.target.closest(".ts-list-item");
    if (!item) {
      return;
    }

    playTrack(parseInt(item.dataset.index, 10));
  }

  function scrollCurrentTrackIntoView() {
    if (state.panelMode === PANEL_MODES.ANCHORED && state.anchoredCompact) {
      return;
    }

    const currentIndex = isValidTrackIndex(state.currentTrackIndex)
      ? state.currentTrackIndex
      : getEffectiveCurrentTrackIndex();
    if (!isValidTrackIndex(currentIndex)) {
      return;
    }

    playerView.scrollTrackIntoView(currentIndex);
  }

  function updateProgress(video = getReadySessionVideo()) {
    ensurePlayerUi();
    const track = getProgressTrack(video);
    if (!video || !track) {
      playerView.renderProgress({
        active: false,
        timeMode: state.settings.progressTimeMode,
      });
      return;
    }

    const duration = getTrackDuration(track);
    const elapsed = clamp(video.currentTime - track.start, 0, duration);
    playerView.renderProgress({
      active: true,
      duration,
      elapsed,
      timeMode: state.settings.progressTimeMode,
    });
  }

  function renderPlayerView({
    controlsEnabled,
    inlineCompact,
    tracksAvailable,
    video,
    visible,
  }) {
    const isFloating = state.panelMode === PANEL_MODES.FLOATING;
    const isAnchoredCompact = state.panelMode === PANEL_MODES.ANCHORED && state.anchoredCompact;
    playerView.render({
      anchored: state.panelMode === PANEL_MODES.ANCHORED,
      anchoredCompact: isAnchoredCompact,
      controlsEnabled,
      currentTrackIndex: state.currentTrackIndex,
      floating: isFloating,
      inlineCompact,
      playing: Boolean(video && !video.paused),
      repeatEnabled: state.playback.repeatMode === REPEAT_MODES.ONE,
      shuffleEnabled: state.playback.shuffleEnabled,
      tracks: state.tracks,
      tracksAvailable,
      visible,
    });
    updateProgress(video);
  }

  function updateUi() {
    const session = state.session;
    if (!isCurrentSession(session)) {
      return;
    }

    ensurePlayerUi();
    const video = getReadySessionVideo(session);
    const videoId = getCurrentVideoId();
    const tracksAvailable = tracksBelongToVideo(videoId);
    const controlsEnabled = Boolean(video && tracksAvailable);
    const isAnchoredCompact = state.panelMode === PANEL_MODES.ANCHORED && state.anchoredCompact;
    const isVisible = isPlayerPanelVisible(tracksAvailable);
    const isInlineCompact = isVisible && isAnchoredCompact;
    syncLauncherForSession(session, tracksAvailable, { restorePlayer: false });
    const mountedInlineCompact = playerLayout.prepareMount({ inlineCompact: isInlineCompact });
    renderPlayerView({
      controlsEnabled,
      inlineCompact: mountedInlineCompact,
      tracksAvailable,
      video,
      visible: isVisible,
    });
    playerLayout.layoutNow({
      anchoredCompact: state.anchoredCompact,
      inlineCompact: mountedInlineCompact,
      panelMode: state.panelMode,
      visible: isVisible,
    });
  }

  init();
})();
