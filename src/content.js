(() => {
  const LAUNCHER_ID = "timestamp-player-launcher";
  const SCAN_DELAY_MS = 600;
  const LAUNCHER_SYNC_DELAY_MS = 50;
  const DESCRIPTION_EXPAND_FALLBACK_DELAY_MS = 2500;
  const COMMENT_MIN_TRACKS = 3;
  const COMMENT_FETCH_BATCH_LIMIT = 3;
  const REGULAR_COMMENT_SCAN_LIMIT = 30;
  const TRACK_END_GRACE_SECONDS = 0.35;
  const PREVIOUS_RESTART_SECONDS = 3;
  const COMMENT_SOURCE_TYPES = {
    PINNED: "pinned",
    UPLOADER: "uploader",
    REGULAR: "regular",
  };
  const {
    scoreCommentTrackSource,
  } = globalThis.TimestampPlayerCommentScoring;
  const {
    COMMENT_FETCH_OUTCOMES,
    fetchCommentRecords,
  } = globalThis.TimestampPlayerCommentFetching;
  const {
    createTrackTitleCache,
    retainFetchedCommentResult,
    storeSettledTrackTitles,
  } = globalThis.TimestampPlayerDiscoveryCache;
  const {
    getNativeTimestampDiscovery,
  } = globalThis.TimestampPlayerNativeTimestamps;
  const {
    findTracks,
    formatTimestamp,
    formatTrackLabel,
    getTextTimestampCandidates,
  } = globalThis.TimestampPlayerTimestamps;
  const {
    createYouTubeDom,
  } = globalThis.TimestampPlayerYouTubeDom;
  const {
    COMPACT_PROGRESS_COLORS,
    COMPACT_PROGRESS_STYLES,
    DEFAULT_SETTINGS,
    TRACK_HIGHLIGHT_COLORS,
    addSettingsChangeListener,
    loadSettings,
    normalizeSettings,
    saveSettings,
  } = globalThis.TimestampPlayerSettings;
  const {
    createWatchRouteController,
    getWatchVideoId,
  } = globalThis.TimestampPlayerWatchRoute;
  const {
    OWNERSHIP_CONFIDENCE,
    TRACK_SOURCE_KINDS,
    TRACK_SOURCE_STATUSES,
    beginTrackSelectionObservation,
    classifyNativeTrackSourceOwnership,
    classifyTrackSourceOwnership,
    considerTrackSource,
    createTrackSourceResult,
    enrichTrackSourceFromCache,
    observeTrackSourceOwnership,
    shouldConsiderNativeSource,
    trackSourceNeedsTitleEnrichment,
  } = globalThis.TimestampPlayerTrackSelection;
  const {
    COMMENT_DISCOVERY_STATUSES,
    createWatchSession,
    disposeWatchSession,
    isWatchSessionCurrent,
    resetSessionRetry,
    scheduleSessionRetry,
    scheduleSessionTask,
  } = globalThis.TimestampPlayerWatchSession;
  const {
    VIDEO_RESOLUTION_STATUSES,
  } = globalThis.TimestampPlayerVideoResolver;
  const {
    getReadySessionVideo: getBoundReadySessionVideo,
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
    PROGRESS_TIME_MODES,
    ROOT_ID: PLAYER_ROOT_ID,
    createPlayerViewController,
  } = globalThis.TimestampPlayerPlayerView;
  const {
    REPEAT_MODES,
    clearPlaybackOrder,
    createPlaybackState,
    recordTrackSelection,
    resetPlaybackState,
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
    progressTimeMode: DEFAULT_SETTINGS.progressTimeMode,
    panelOpen: false,
    panelMode: PANEL_MODES.ANCHORED,
    anchoredCompact: false,
    settings: { ...DEFAULT_SETTINGS },
    tracks: [],
    currentTrackIndex: -1,
    trackTitleCache: createTrackTitleCache(),
    pageObserver: null,
    pageObserverRoot: null,
    settingsChangeCleanup: null,
  };

  let launcherButton;
  let playerShellRoot = null;
  let watchRouteController = null;
  const youtubeDom = createYouTubeDom({ Node, document, location });
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
    loadStoredSettings();
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
    state.settingsChangeCleanup?.();
    state.settingsChangeCleanup = null;
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

  function loadStoredSettings() {
    loadSettings((settings) => {
      setSettings(settings);
    });

    state.settingsChangeCleanup?.();
    state.settingsChangeCleanup = addSettingsChangeListener((changes) => {
      const nextSettings = { ...state.settings };
      let settingsChanged = false;
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (Object.hasOwn(changes, key)) {
          nextSettings[key] = changes[key].newValue;
          settingsChanged = true;
        }
      }

      if (settingsChanged) {
        setSettings(nextSettings);
      }
    });
  }

  function setSettings(settings) {
    state.settings = normalizeSettings(settings);
    state.progressTimeMode = state.settings.progressTimeMode;
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
    disposeWatchSession(session, reason);
    resetSessionViewState();
  }

  function resetSessionViewState() {
    state.playback = resetPlaybackState();
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
      onDiscovery: () => scheduleScan(session),
      onLauncher: () => scheduleLauncherSync(session),
      onMedia: () => scheduleMediaRefresh(session),
    });
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

  function scheduleReadinessRetry(session, phase) {
    if (!isCurrentSession(session)) {
      return false;
    }

    session.phase = phase;
    const scheduled = scheduleSessionRetry(
      session,
      "readiness",
      () => scanPage(session)
    );
    if (!scheduled && session.retries.readiness.exhausted) {
      session.phase = "readiness-exhausted";
    }
    return scheduled;
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
    return resolution;
  }

  function refreshSessionMedia(session) {
    if (!isCurrentSession(session)) {
      return;
    }

    const previousElement = session.media.element;
    const previousStatus = session.media.resolution?.status || null;
    const resolution = resolveSessionMedia(session);
    if (!resolution || !isCurrentSession(session)) {
      return;
    }

    const mediaChanged = previousElement !== resolution.element
      || previousStatus !== resolution.status;
    if (resolution.status === VIDEO_RESOLUTION_STATUSES.READY) {
      if (mediaChanged) {
        resetSessionRetry(session, "readiness");
        scheduleScan(session, 0);
      }
    } else if (resolution.status !== VIDEO_RESOLUTION_STATUSES.AD_PLAYING) {
      scheduleReadinessRetry(session, getMediaReadinessPhase(resolution.status));
    }
    updateUi();
  }

  function getMediaReadinessPhase(status) {
    if (status === VIDEO_RESOLUTION_STATUSES.WAITING_FOR_DURATION) {
      return "waiting-for-duration";
    }
    if (status === VIDEO_RESOLUTION_STATUSES.WAITING_FOR_OWNERSHIP) {
      return "waiting-for-video-ownership";
    }
    return "waiting-for-video";
  }

  function scanPage(session) {
    if (!isCurrentSession(session)) {
      return;
    }

    bindWatchPageObserver();

    const resolution = resolveSessionMedia(session);
    const video = getReadySessionVideo(session);
    const videoId = session.videoId;

    if (!video) {
      if (resolution?.status !== VIDEO_RESOLUTION_STATUSES.AD_PLAYING) {
        scheduleReadinessRetry(session, getMediaReadinessPhase(resolution?.status));
      } else {
        session.phase = "ad-playing";
      }
      updateUi();
      return;
    }

    session.phase = "discovering";
    const observation = beginTrackSelectionObservation(session.trackSelection);
    let awaitingSourceConfirmation = false;
    const quietDescriptionReadable = canReadQuietDescription(videoId);
    const descriptionDiscovery = getDescriptionSourceResults(session, video.duration, observation);
    awaitingSourceConfirmation = considerTrackSourceResults(session, descriptionDiscovery.results)
      || awaitingSourceConfirmation;
    const descriptionSelected = selectedSourceKind(session) === TRACK_SOURCE_KINDS.DESCRIPTION;

    if (
      !descriptionSelected
      && descriptionDiscovery.candidateCount < 2
      && !quietDescriptionReadable
      && shouldWaitForQuietDescriptionScan(session)
    ) {
      scheduleReadinessRetry(session, "waiting-for-description");
      applySelectedTracksForSession(session, video);
      updateUi();
      return;
    }

    if (
      !descriptionSelected
      && descriptionDiscovery.candidateCount < 2
      && !quietDescriptionReadable
      && expandDescriptionIfAvailable(session)
    ) {
      applySelectedTracksForSession(session, video);
      updateUi("Reading description...");
      return;
    }

    const shouldDiscoverAlternativeSources = !descriptionSelected
      || trackSourceNeedsTitleEnrichment(session.trackSelection.current);
    if (shouldDiscoverAlternativeSources) {
      const commentStatus = session.commentDiscovery.status === COMMENT_DISCOVERY_STATUSES.DONE
        ? TRACK_SOURCE_STATUSES.SETTLED
        : TRACK_SOURCE_STATUSES.PROVISIONAL;
      awaitingSourceConfirmation = considerTrackSourceResults(
        session,
        getDomCommentSourceResults(session, video.duration, observation, commentStatus)
      ) || awaitingSourceConfirmation;
      const fetchedCommentDiscovery = getFetchedCommentDiscoveryForSession(session, video.duration);
      if (fetchedCommentDiscovery.result) {
        awaitingSourceConfirmation = considerTrackSourceResults(
          session,
          [fetchedCommentDiscovery.result]
        ) || awaitingSourceConfirmation;
      }
    }

    if (
      shouldConsiderNativeSource(session.trackSelection)
      && shouldUseNativeTimestampFallback()
    ) {
      const nativeResult = getNativeSourceResult(session, video.duration, observation);
      if (nativeResult) {
        awaitingSourceConfirmation = considerTrackSourceResults(session, [nativeResult])
          || awaitingSourceConfirmation;
      }
    }

    const selectedResult = session.trackSelection.current;
    if (
      selectedResult?.status === TRACK_SOURCE_STATUSES.SETTLED
      && !awaitingSourceConfirmation
    ) {
      resetSessionRetry(session, "readiness");
      session.phase = "ready";
    } else if (selectedResult) {
      scheduleReadinessRetry(
        session,
        awaitingSourceConfirmation ? "verifying-source" : "provisional"
      );
    } else {
      scheduleReadinessRetry(session, "discovering-sources");
    }

    if (!isCurrentSession(session)) {
      return;
    }

    applySelectedTracksForSession(session, video);
    maybeAutoOpenCompact(session);
    collapseDescriptionIfNeeded(session);
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

  function considerTrackSourceResults(session, results) {
    let awaitingOwnershipConfirmation = false;
    const cachedTitles = state.trackTitleCache.get(session.videoId);
    for (const result of results) {
      const ownedResult = observeTrackSourceOwnership(session.trackSelection, result);
      if (!ownedResult) {
        awaitingOwnershipConfirmation = awaitingOwnershipConfirmation
          || result.ownership.confidence === OWNERSHIP_CONFIDENCE.WEAK;
        continue;
      }

      const enrichedResult = enrichTrackSourceFromCache(
        ownedResult,
        cachedTitles
      );
      considerTrackSource(session.trackSelection, enrichedResult, {
        generation: session.generation,
        videoId: session.videoId,
      });
    }
    return awaitingOwnershipConfirmation;
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

    session.description.expanded = true;
    session.description.shouldCollapse = true;
    expandButton.click();
    scheduleScan(session);
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

    const launcherAttached = syncLauncher(tracksAvailable);
    syncLauncherRetry(session, tracksAvailable, launcherAttached);
    if (launcherAttached && restorePlayer) {
      restorePlayerAfterLauncherSync(tracksAvailable);
    }
    return launcherAttached;
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

    scheduleSessionRetry(session, "launcher", () => {
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

  function getDescriptionSourceResults(session, duration, observation) {
    const results = [];
    let candidateCount = 0;

    for (const root of youtubeDom.getDescriptionRoots(session.videoId)) {
      const ownership = getDomSourceOwnership(root, session.videoId);
      if (!ownership) {
        continue;
      }

      const sourceId = getDomSourceId(session, root);
      const discovery = youtubeDom.readDescriptionRoot(root, {
        sourceId,
        videoId: session.videoId,
      });
      if (!discovery) {
        continue;
      }

      candidateCount = Math.max(candidateCount, discovery.candidateCount);
      const tracks = findTracks(duration, discovery.candidates);
      if (tracks.length < 2) {
        continue;
      }

      results.push(createTrackSourceResult({
        channel: "description-dom",
        duration,
        generation: session.generation,
        kind: TRACK_SOURCE_KINDS.DESCRIPTION,
        observation,
        ownership,
        sourceId,
        status: TRACK_SOURCE_STATUSES.SETTLED,
        tracks,
        videoId: session.videoId,
      }));
    }

    return { candidateCount, results };
  }

  function shouldUseNativeTimestampFallback() {
    // Keep native YouTube Key moments as an isolated fallback so a future source
    // preference can disable it without changing the rest of the scan pipeline.
    return true;
  }

  function getNativeSourceResult(session, duration, observation) {
    const discovery = getNativeTimestampDiscovery(session.videoId);
    if (discovery.hasMismatchedVideoId) {
      return null;
    }

    const tracks = findTracks(duration, discovery.candidates);
    if (tracks.length < 2) {
      return null;
    }

    const ownership = classifyNativeTrackSourceOwnership(
      discovery.candidates,
      session.videoId
    );
    if (!ownership) {
      return null;
    }

    return createTrackSourceResult({
      channel: "native-dom",
      duration,
      generation: session.generation,
      kind: TRACK_SOURCE_KINDS.NATIVE,
      observation,
      ownership,
      sourceId: "native-page",
      status: session.commentDiscovery.status === COMMENT_DISCOVERY_STATUSES.DONE
        ? TRACK_SOURCE_STATUSES.SETTLED
        : TRACK_SOURCE_STATUSES.PROVISIONAL,
      tracks,
      videoId: session.videoId,
    });
  }

  function getDomSourceOwnership(root, videoId) {
    return classifyTrackSourceOwnership({
      ...youtubeDom.getOwnershipEvidence(root),
      videoId,
    });
  }

  function getDomSourceId(session, root) {
    let sourceId = session.domSources.ids.get(root);
    if (!sourceId) {
      sourceId = String(session.domSources.nextId);
      session.domSources.nextId += 1;
      session.domSources.ids.set(root, sourceId);
    }
    return sourceId;
  }

  function getDomCommentSourceResults(session, duration, observation, status) {
    const results = [];
    let regularCommentCount = 0;

    for (const [order, root] of youtubeDom.getCommentRoots(session.videoId).entries()) {
      const ownership = getDomSourceOwnership(root, session.videoId);
      if (!ownership) {
        continue;
      }

      const sourceId = getDomSourceId(session, root);
      const comment = youtubeDom.readCommentRoot(root, {
        sourceId,
        videoId: session.videoId,
      });
      const sourceType = comment.isPinned
        ? COMMENT_SOURCE_TYPES.PINNED
        : comment.isUploader
          ? COMMENT_SOURCE_TYPES.UPLOADER
          : COMMENT_SOURCE_TYPES.REGULAR;
      if (sourceType === COMMENT_SOURCE_TYPES.REGULAR) {
        regularCommentCount += 1;
        if (regularCommentCount > REGULAR_COMMENT_SCAN_LIMIT) {
          continue;
        }
      }

      const tracks = findTracks(duration, comment.candidates, COMMENT_MIN_TRACKS);
      if (tracks.length < COMMENT_MIN_TRACKS) {
        continue;
      }

      const scoredSource = {
        duration,
        likeCount: comment.likeCount,
        order,
        sourceType,
        tracks,
      };
      results.push(createTrackSourceResult({
        channel: "comment-dom",
        duration,
        generation: session.generation,
        kind: TRACK_SOURCE_KINDS.COMMENT,
        observation,
        ownership,
        sourceId,
        sourceScore: scoreCommentTrackSource(scoredSource),
        status,
        tracks,
        videoId: session.videoId,
      }));
    }

    return results;
  }

  function getFetchedCommentDiscoveryForSession(session, duration) {
    if (session.commentDiscovery.status === COMMENT_DISCOVERY_STATUSES.IDLE) {
      startCommentFetch(session, duration);
    }
    return session.commentDiscovery;
  }

  function startCommentFetch(session, duration) {
    const { videoId } = session;
    const discovery = session.commentDiscovery;
    if (typeof fetchCommentRecords !== "function") {
      discovery.outcome = COMMENT_FETCH_OUTCOMES.UNSUPPORTED;
      discovery.status = COMMENT_DISCOVERY_STATUSES.DONE;
      return discovery;
    }

    discovery.outcome = null;
    discovery.status = COMMENT_DISCOVERY_STATUSES.PENDING;
    fetchCommentRecords({
      maxBatches: COMMENT_FETCH_BATCH_LIMIT,
      signal: session.abortController.signal,
      videoId,
    })
      .then((result) => finishCommentFetch(session, duration, result))
      .catch(() => finishCommentFetch(session, duration, {
        records: [],
        retryable: true,
        status: COMMENT_FETCH_OUTCOMES.TRANSIENT_ERROR,
      }))
      .finally(() => {
        if (isCurrentSession(session)) {
          scheduleScan(session);
        }
      });
    return discovery;
  }

  function finishCommentFetch(session, duration, result) {
    if (!isCurrentSession(session)) {
      return;
    }

    const discovery = session.commentDiscovery;
    const records = Array.isArray(result?.records) ? result.records : [];
    discovery.outcome = result?.status || COMMENT_FETCH_OUTCOMES.UNSUPPORTED;
    const retryable = shouldRetryCommentFetch(result);
    const retryScheduled = retryable && scheduleSessionRetry(
      session,
      "commentFetch",
      () => {
        if (isCurrentSession(session)) {
          startCommentFetch(session, duration);
        }
      }
    );
    discovery.status = retryScheduled
      ? COMMENT_DISCOVERY_STATUSES.RETRY_WAIT
      : COMMENT_DISCOVERY_STATUSES.DONE;
    const sourceStatus = retryScheduled
      ? TRACK_SOURCE_STATUSES.PROVISIONAL
      : TRACK_SOURCE_STATUSES.SETTLED;
    const incomingResult = getBestFetchedCommentResult(
      session,
      records,
      duration,
      sourceStatus
    );
    discovery.result = retainFetchedCommentResult(
      discovery.result,
      incomingResult,
      sourceStatus
    );
    if (!retryScheduled && !retryable) {
      resetSessionRetry(session, "commentFetch");
    }
  }

  function shouldRetryCommentFetch(result) {
    return Boolean(
      result?.retryable
      && (
        result.status === COMMENT_FETCH_OUTCOMES.PARTIAL
        || result.status === COMMENT_FETCH_OUTCOMES.TRANSIENT_ERROR
        || result.status === COMMENT_FETCH_OUTCOMES.UNSUPPORTED
      )
    );
  }

  function getBestFetchedCommentResult(session, records, duration, status) {
    const results = records.map((record) => {
      const candidates = getTextTimestampCandidates(record.text, `fetched-comment:${record.order}`);
      const tracks = findTracks(duration, candidates, COMMENT_MIN_TRACKS);
      if (tracks.length < COMMENT_MIN_TRACKS) {
        return null;
      }

      const sourceType = getFetchedCommentSourceType(record);
      const scoredSource = {
        duration,
        sourceType,
        order: record.order,
        likeCount: record.likeCount,
        tracks,
      };
      return createTrackSourceResult({
        channel: "comment-api",
        duration,
        generation: session.generation,
        kind: TRACK_SOURCE_KINDS.COMMENT,
        observation: session.trackSelection.observation,
        ownership: {
          confidence: OWNERSHIP_CONFIDENCE.STRONG,
          evidence: "network-request",
        },
        sourceId: record.commentId || String(record.order),
        sourceScore: scoreCommentTrackSource(scoredSource),
        status,
        tracks,
        videoId: session.videoId,
      });
    }).filter(Boolean);

    return results.reduce((best, candidate) => {
      return !best || candidate.sourceScore > best.sourceScore ? candidate : best;
    }, null);
  }

  function getFetchedCommentSourceType(record) {
    if (record.isPinned) {
      return COMMENT_SOURCE_TYPES.PINNED;
    }

    if (record.isUploader) {
      return COMMENT_SOURCE_TYPES.UPLOADER;
    }

    return COMMENT_SOURCE_TYPES.REGULAR;
  }

  function canReadQuietDescription(videoId) {
    return youtubeDom.getQuietDescriptionRoots(videoId).some((root) => {
      if (!getDomSourceOwnership(root, videoId)) {
        return false;
      }
      return youtubeDom.isDescriptionRootReadable(root);
    });
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
  }

  function togglePanelMode() {
    if (!state.panelOpen) {
      return;
    }

    if (state.panelMode === PANEL_MODES.ANCHORED) {
      playerLayout.seedFloatingFromCurrentRect();
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
    state.progressTimeMode =
      state.progressTimeMode === PROGRESS_TIME_MODES.REMAINING
        ? PROGRESS_TIME_MODES.DURATION
        : PROGRESS_TIME_MODES.REMAINING;
    saveSettings({ progressTimeMode: state.progressTimeMode });
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

    if (event.type === "timeupdate") {
      handleTimeUpdate(video);
      return;
    }

    if (event.type === "play" || event.type === "pause") {
      updateUi();
    }
  }

  function handleTimeUpdate(video) {
    if (video !== getReadySessionVideo()) {
      return;
    }

    if (!tracksBelongToVideo()) {
      updateUi();
      return;
    }

    const currentTrack = getCurrentTrack(video.currentTime);
    if (currentTrack && currentTrack.index !== state.currentTrackIndex) {
      state.currentTrackIndex = currentTrack.index;
      updateUi();
      return;
    }

    const activeTrack = state.tracks[state.currentTrackIndex];
    if (activeTrack && video.currentTime >= activeTrack.end - TRACK_END_GRACE_SECONDS) {
      if (state.playback.repeatMode === REPEAT_MODES.ONE) {
        playTrack(activeTrack.index, { recordHistory: false });
        return;
      } else if (state.playback.shuffleEnabled) {
        playNextTrack({
          currentIndex: activeTrack.index,
          previousIndex: activeTrack.index,
        });
        return;
      } else if (state.playback.repeatMode === REPEAT_MODES.ALL && activeTrack.index === state.tracks.length - 1) {
        playTrack(0, { previousIndex: activeTrack.index });
        return;
      }
    }

    updateProgress(video);
  }

  function handleFullscreenChange() {
    updateUi();
    playerLayout.schedule();
  }

  function isFullscreenActive() {
    return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function getCurrentTrack(time) {
    return getTrackAtTime(time);
  }

  function getTrackAtTime(time) {
    if (!tracksBelongToVideo()) {
      return null;
    }

    return state.tracks.find((track) => time >= track.start && time < track.end) || null;
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

    const elements = playerView.getElements();
    const item = playerView.getTrackRowForIndex(currentIndex);
    if (!elements?.listEl || !item) {
      return;
    }

    const { listEl } = elements;
    const listRect = listEl.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const targetTop = listEl.scrollTop + itemRect.top - listRect.top;

    listEl.scrollTo({
      top: Math.max(0, targetTop),
      behavior: "smooth",
    });
  }

  function updateProgress(video = getReadySessionVideo()) {
    ensurePlayerUi();
    const track = getProgressTrack(video);
    if (!video || !track) {
      playerView.renderProgress({
        active: false,
        timeMode: state.progressTimeMode,
      });
      return;
    }

    const duration = getTrackDuration(track);
    const elapsed = clamp(video.currentTime - track.start, 0, duration);
    playerView.renderProgress({
      active: true,
      duration,
      elapsed,
      timeMode: state.progressTimeMode,
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
