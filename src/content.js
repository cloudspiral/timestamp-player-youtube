(() => {
  const ROOT_ID = "timestamp-player-root";
  const LAUNCHER_ID = "timestamp-player-launcher";
  const COMPACT_HOST_ID = "timestamp-player-compact-host";
  const SCAN_DELAY_MS = 600;
  const LAUNCHER_SYNC_DELAY_MS = 50;
  const DESCRIPTION_EXPAND_FALLBACK_DELAY_MS = 2500;
  const COMMENT_MIN_TRACKS = 3;
  const COMMENT_FETCH_BATCH_LIMIT = 3;
  const REGULAR_COMMENT_SCAN_LIMIT = 30;
  const DRAG_VIEWPORT_PADDING = 8;
  const PLAYER_MIN_WIDTH = 260;
  const PLAYER_MIN_HEIGHT = 128;
  const PLAYER_MIN_VISIBLE_WIDTH = 180;
  const PLAYER_MIN_VISIBLE_HEIGHT = 100;
  const COMPACT_PLAYER_MIN_WIDTH = 300;
  const TRACK_END_GRACE_SECONDS = 0.35;
  const PREVIOUS_RESTART_SECONDS = 3;
  const PROGRESS_TIME_MODES = {
    REMAINING: "remaining",
    DURATION: "duration",
  };
  const PANEL_MODES = {
    ANCHORED: "anchored",
    FLOATING: "floating",
  };
  const RESIZE_MODES = {
    FLOATING: "floating",
    ANCHORED: "anchored",
    COMPACT_WIDTH: "compact-width",
  };
  const COMMENT_SOURCE_TYPES = {
    PINNED: "pinned",
    UPLOADER: "uploader",
    REGULAR: "regular",
  };
  const {
    parseCommentLikeCount,
    scoreCommentTrackSource,
  } = globalThis.TimestampPlayerCommentScoring;
  const {
    COMMENT_FETCH_OUTCOMES,
    fetchCommentRecords,
  } = globalThis.TimestampPlayerCommentFetching;
  const {
    getNativeTimestampDiscovery,
    isNativeTimestampSectionElement,
  } = globalThis.TimestampPlayerNativeTimestamps;
  const {
    cleanTrackTitle,
    findTracks,
    formatTimestamp,
    formatTrackLabel,
    getTextTimestampCandidates,
    isTimestampRangeEndMarker,
    lineContainingTimestamp,
    normalizeTitleText,
    parseTimeParam,
    parseTimestampText,
    titleFromLineFragment,
  } = globalThis.TimestampPlayerTimestamps;
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
    dispatchWatchMutations,
    getPreferredWatchMutationRoot,
    getTrackMutationInterests,
  } = globalThis.TimestampPlayerWatchMutations;
  const {
    createTrackListRenderer,
  } = globalThis.TimestampPlayerTrackListRenderer;
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
    trackCache: new Map(),
    playerPosition: null,
    playerSize: null,
    anchoredWidth: null,
    anchoredHeight: null,
    compactWidth: null,
    playerLayoutFrame: null,
    pageObserver: null,
    pageObserverRoot: null,
    settingsChangeCleanup: null,
  };

  let root;
  let launcherButton;
  let compactHost;
  let dragHandle;
  let resizeHandle;
  let compactButton;
  let popoutButton;
  let closeButton;
  let trackEl;
  let countEl;
  let progressElapsedEl;
  let progressRemainingEl;
  let progressSlider;
  let listEl;
  let previousButton;
  let playPauseButton;
  let toggleButton;
  let repeatButton;
  let nextButton;
  let trackListRenderer;
  let dragPointerId = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let resizePointerId = null;
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeStartWidth = 0;
  let resizeStartHeight = 0;
  let resizeStartLeft = 0;
  let resizeStartTop = 0;
  let resizeMode = null;
  let watchRouteController = null;

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
    ensureUi();
    applySettingsToUi();
    loadStoredSettings();
    state.pageObserver = new MutationObserver(handlePageMutations);
    bindWatchPageObserver();
    document.addEventListener("timeupdate", handleTimeUpdate, true);
    document.addEventListener("play", handlePlaybackStateChange, true);
    document.addEventListener("pause", handlePlaybackStateChange, true);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    window.addEventListener("resize", schedulePlayerLayout);
    window.visualViewport?.addEventListener("resize", schedulePlayerLayout);
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
        "aria-expanded",
        "aria-hidden",
        "class",
        "hidden",
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
    if (state.playerLayoutFrame !== null) {
      cancelAnimationFrame(state.playerLayoutFrame);
      state.playerLayoutFrame = null;
    }
    document.removeEventListener("timeupdate", handleTimeUpdate, true);
    document.removeEventListener("play", handlePlaybackStateChange, true);
    document.removeEventListener("pause", handlePlaybackStateChange, true);
    document.removeEventListener("fullscreenchange", handleFullscreenChange);
    document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    window.removeEventListener("resize", schedulePlayerLayout);
    window.visualViewport?.removeEventListener("resize", schedulePlayerLayout);
    removeWatchPageUi();
  }

  function removeWatchPageUi() {
    cancelPointerInteractions();
    trackListRenderer?.clear();
    launcherButton?.remove();
    compactHost?.remove();
    root?.remove();
    root = null;
    launcherButton = null;
    compactHost = null;
    dragHandle = null;
    resizeHandle = null;
    compactButton = null;
    popoutButton = null;
    closeButton = null;
    trackEl = null;
    countEl = null;
    progressElapsedEl = null;
    progressRemainingEl = null;
    progressSlider = null;
    listEl = null;
    previousButton = null;
    playPauseButton = null;
    toggleButton = null;
    repeatButton = null;
    nextButton = null;
    trackListRenderer = null;
    dragPointerId = null;
    resizePointerId = null;
    resizeMode = null;
  }

  function cancelPointerInteractions() {
    if (dragPointerId !== null && dragHandle?.hasPointerCapture?.(dragPointerId)) {
      dragHandle.releasePointerCapture(dragPointerId);
    }
    dragHandle?.removeEventListener("pointermove", handleDragPointerMove);
    dragHandle?.removeEventListener("pointerup", handleDragPointerEnd);
    dragHandle?.removeEventListener("pointercancel", handleDragPointerEnd);

    if (resizePointerId !== null && resizeHandle?.hasPointerCapture?.(resizePointerId)) {
      resizeHandle.releasePointerCapture(resizePointerId);
    }
    resizeHandle?.removeEventListener("pointermove", handleResizePointerMove);
    resizeHandle?.removeEventListener("pointerup", handleResizePointerEnd);
    resizeHandle?.removeEventListener("pointercancel", handleResizePointerEnd);

    progressSlider?.removeEventListener("pointermove", handleProgressPointerMove);
    progressSlider?.removeEventListener("pointerup", handleProgressPointerEnd);
    progressSlider?.removeEventListener("pointercancel", handleProgressPointerEnd);
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
    syncLayoutSettingsToState();
    if (!state.watchPageActive) {
      return;
    }
    applySettingsToUi();
    maybeAutoOpenCompact(state.session);
    updateUi();
  }

  function syncLayoutSettingsToState() {
    state.playerPosition = state.settings.floatingPlayerPosition;
    state.playerSize = state.settings.floatingPlayerSize;
    state.anchoredWidth = state.settings.anchoredPlayerSize?.width ?? null;
    state.anchoredHeight = state.settings.anchoredPlayerSize?.height ?? null;
    state.compactWidth = state.settings.compactPlayerWidth;
  }

  function applySettingsToUi() {
    if (!root) {
      return;
    }

    const compactProgressStyle =
      COMPACT_PROGRESS_STYLES[state.settings.compactProgressStyle] || COMPACT_PROGRESS_STYLES.subtle;
    const compactProgressColor = resolveProgressColor(
      state.settings.compactProgressColor,
      state.settings.compactProgressCustomColor
    );
    const progressColor = resolveProgressColor(state.settings.progressColor, state.settings.progressCustomColor);
    const highlightColor = TRACK_HIGHLIGHT_COLORS[state.settings.trackHighlightColor] || TRACK_HIGHLIGHT_COLORS.purple;

    root.style.setProperty("--ts-compact-progress-height", compactProgressStyle.height);
    root.style.setProperty("--ts-compact-progress-opacity", compactProgressStyle.opacity);
    root.style.setProperty("--ts-compact-progress-color", compactProgressColor);
    root.style.setProperty("--ts-progress-color", progressColor);
    root.style.setProperty("--ts-active-track-bg", highlightColor.bg);
    root.style.setProperty("--ts-active-track-hover-bg", highlightColor.hoverBg);
    root.style.setProperty("--ts-active-track-text", highlightColor.text);
  }

  function resolveProgressColor(colorName, customColor) {
    const colorChoice = COMPACT_PROGRESS_COLORS[colorName] || COMPACT_PROGRESS_COLORS.red;
    return colorName === "custom" ? customColor : colorChoice.color;
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
        element === root
        || root?.contains(element)
        || element === launcherButton
        || launcherButton?.contains(element)
        || element === compactHost
        || compactHost?.contains(element)
      )
    );
  }

  function scheduleScan(session, delay = SCAN_DELAY_MS) {
    if (!isCurrentSession(session)) {
      return false;
    }

    return scheduleSessionTask(session, "scan", () => scanPage(session), { delay });
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

  function scanPage(session) {
    if (!isCurrentSession(session)) {
      return;
    }

    bindWatchPageObserver();

    const video = getVideo();
    const videoId = session.videoId;

    if (!video) {
      scheduleReadinessRetry(session, "waiting-for-video");
      updateUi("Open a YouTube video");
      return;
    }

    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      scheduleReadinessRetry(session, "waiting-for-duration");
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
    for (const result of results) {
      const ownedResult = observeTrackSourceOwnership(session.trackSelection, result);
      if (!ownedResult) {
        awaitingOwnershipConfirmation = awaitingOwnershipConfirmation
          || result.ownership.confidence === OWNERSHIP_CONFIDENCE.WEAK;
        continue;
      }

      const enrichedResult = enrichTrackSourceFromCache(
        ownedResult,
        state.trackCache.get(session.videoId)
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
    if (selectedResult) {
      state.trackCache.set(session.videoId, selectedResult);
    }
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

  function getVideo() {
    return document.querySelector("video.html5-main-video") || document.querySelector("video");
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

    const expandButton = findDescriptionExpandButton();
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

    const collapseButton = findDescriptionCollapseButton();
    if (!collapseButton) {
      return;
    }

    session.description.shouldCollapse = false;
    collapseButton.click();
  }

  function findDescriptionExpandButton() {
    const candidates = [
      ...document.querySelectorAll(
        [
          "ytd-watch-metadata ytd-text-inline-expander #expand",
          "ytd-watch-metadata #description-inline-expander #expand",
          "ytd-watch-metadata tp-yt-paper-button#expand",
          "ytd-watch-metadata button",
        ].join(",")
      ),
    ];

    return candidates.find((element) => {
      const text = normalizeTitleText(element.textContent).toLowerCase();
      return isVisible(element) && (element.id === "expand" || text.includes("more"));
    }) || null;
  }

  function findDescriptionCollapseButton() {
    const candidates = [
      ...document.querySelectorAll(
        [
          "ytd-watch-metadata ytd-text-inline-expander #collapse",
          "ytd-watch-metadata #description-inline-expander #collapse",
          "ytd-watch-metadata tp-yt-paper-button#collapse",
          "ytd-watch-metadata button",
        ].join(",")
      ),
    ];

    return candidates.find((element) => {
      const text = normalizeTitleText(element.textContent).toLowerCase();
      return isVisible(element) && (element.id === "collapse" || text.includes("show less"));
    }) || null;
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function syncLauncher(tracksAvailable) {
    if (!tracksAvailable) {
      movePlayerToOverlayRoot();
      launcherButton?.remove();
      compactHost?.remove();
      return true;
    }

    ensureLauncherButton();
    const actionRow = findActionRow();
    if (!actionRow) {
      return false;
    }

    if (!actionRow.contains(launcherButton)) {
      insertLauncherButton(actionRow);
    }

    launcherButton.classList.toggle("is-active", state.panelOpen);
    launcherButton.setAttribute("aria-pressed", String(state.panelOpen));
    launcherButton.setAttribute("aria-label", state.panelOpen ? "Hide tracklist" : "Open tracklist");
    launcherButton.title = state.panelOpen ? "Hide tracklist" : "Show tracklist";
    return true;
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
    const isHiddenByFullscreen = isFullscreenActive() && state.panelMode === PANEL_MODES.ANCHORED;
    const isVisible = tracksAvailable && state.panelOpen && !isHiddenByFullscreen;
    if (!isVisible) {
      return;
    }

    const inlineCompact = state.panelMode === PANEL_MODES.ANCHORED && state.anchoredCompact;
    const mountedInlineCompact = mountPlayerForMode(inlineCompact);
    root.classList.toggle("is-inline-compact", mountedInlineCompact);
    layoutPlayer();
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
    launcherButton.setAttribute("aria-label", "Open tracklist");
    launcherButton.setAttribute("aria-pressed", "false");
    launcherButton.innerHTML = `
      <svg class="ts-launcher-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 6h10"></path>
        <path d="M4 12h8"></path>
        <path d="M4 18h6"></path>
        <path d="M17 6v8.4a2.4 2.4 0 1 1-1.6-2.3V6h4"></path>
      </svg>
      <span>Tracklist</span>
    `;
    launcherButton.addEventListener("mousedown", preventMouseButtonFocus);
    launcherButton.addEventListener("click", togglePlayerOpen);
  }

  function findActionRow() {
    const candidates = [
      ...document.querySelectorAll(
        [
          "ytd-watch-metadata #top-level-buttons-computed",
          "ytd-watch-metadata ytd-menu-renderer #top-level-buttons-computed",
          "#above-the-fold #top-level-buttons-computed",
        ].join(",")
      ),
    ];

    return candidates.find(isVisible) || null;
  }

  function findCompactActionAnchor() {
    const actionRow = findActionRow();
    const candidates = [
      actionRow?.closest("#actions"),
      actionRow?.closest("ytd-menu-renderer"),
      actionRow?.parentElement,
      ...document.querySelectorAll(
        [
          "ytd-watch-metadata #actions",
          "ytd-watch-metadata ytd-menu-renderer",
          "#above-the-fold #actions",
        ].join(",")
      ),
      actionRow,
    ].filter(Boolean);

    return candidates.find(isVisible) || null;
  }

  function insertLauncherButton(actionRow) {
    const shareButton = [...actionRow.children].find((element) => {
      return normalizeTitleText(element.textContent).toLowerCase().includes("share");
    });

    if (shareButton?.nextSibling) {
      actionRow.insertBefore(launcherButton, shareButton.nextSibling);
    } else {
      actionRow.append(launcherButton);
    }
  }

  function ensureCompactHost(actionRow) {
    if (!compactHost) {
      compactHost = document.createElement("div");
      compactHost.id = COMPACT_HOST_ID;
    }

    if (compactHost.parentElement === actionRow && launcherButton.nextSibling === compactHost) {
      return compactHost;
    }

    if (launcherButton?.nextSibling) {
      actionRow.insertBefore(compactHost, launcherButton.nextSibling);
    } else {
      actionRow.append(compactHost);
    }

    return compactHost;
  }

  function getDescriptionSourceResults(session, duration, observation) {
    const results = [];
    let candidateCount = 0;

    for (const root of getTimestampCandidateRoots()) {
      const ownership = getDomSourceOwnership(root, session.videoId);
      if (!ownership) {
        continue;
      }

      const sourceId = getDomSourceId(session, root);
      const text = removeNativeTimestampSections(root.innerText || root.textContent || "");
      const normalizedText = normalizeTitleText(text);
      if (!normalizedText || isLikelyCollapsedDescriptionTextRoot(root, normalizedText)) {
        continue;
      }

      const textCandidates = getTextTimestampCandidates(text, `description-text:${sourceId}`);
      const titledTextStarts = new Set(
        textCandidates
          .filter((candidate) => candidate.title)
          .map((candidate) => candidate.start)
      );
      const linkCandidates = getLinkTimestampCandidates(session.videoId, [root], {
        excludeNativeTimestampSections: true,
      }).filter((candidate) => !titledTextStarts.has(candidate.start));
      const candidates = [...textCandidates, ...linkCandidates];
      candidateCount = Math.max(candidateCount, candidates.length);
      const tracks = findTracks(duration, candidates);
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

  function getLinkTimestampCandidates(videoId, roots, options = {}) {
    const links = [];
    for (const searchRoot of roots) {
      for (const link of searchRoot.querySelectorAll("a[href*='/watch']")) {
        if (options.excludeNativeTimestampSections && isNativeTimestampSectionElement(link)) {
          continue;
        }
        if (!links.includes(link)) {
          links.push(link);
        }
      }
    }

    return links.map((link) => toTimestampCandidate(link, videoId)).filter(Boolean);
  }

  function getDomSourceOwnership(root, videoId) {
    const linkedVideoIds = [];
    for (const link of root.querySelectorAll("a[href*='/watch']")) {
      const linkedVideoId = getTimestampLinkVideoId(link);
      if (linkedVideoId) {
        linkedVideoIds.push(linkedVideoId);
      }
    }

    const watchShell = root.closest?.("ytd-watch-flexy") || null;
    const shellVideoId = getWatchShellVideoId(watchShell);
    return classifyTrackSourceOwnership({ linkedVideoIds, shellVideoId, videoId });
  }

  function getWatchShellVideoId(watchShell) {
    const videoId = watchShell?.getAttribute?.("video-id") || watchShell?.videoId;
    return typeof videoId === "string" ? videoId.trim() : "";
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

  function isLikelyCollapsedDescriptionTextRoot(root, text) {
    const hasExpandControl = Boolean([...root.querySelectorAll("#expand, tp-yt-paper-button#expand, button")].find((element) => {
      const buttonText = normalizeTitleText(element.textContent).toLowerCase();
      return buttonText.includes("more");
    }));
    if (!hasExpandControl) {
      return false;
    }

    return text.split(/\r?\n/).some((line) => {
      return hasTimestampText(line) && /(?:\.{3}|…)\s*(?:more)?$/i.test(normalizeTitleText(line));
    });
  }

  function hasTimestampText(text) {
    return /\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(text);
  }

  function removeNativeTimestampSections(text) {
    const lines = (text || "").split(/\r?\n/);
    const nativeSectionIndex = lines.findIndex((line, index) => {
      const normalizedLine = normalizeTitleText(line);
      if (/^key moments$/i.test(normalizedLine)) {
        return true;
      }

      return /^chapters$/i.test(normalizedLine)
        && countTimestampLines(lines.slice(0, index)) >= 2;
    });

    return nativeSectionIndex >= 0 ? lines.slice(0, nativeSectionIndex).join("\n") : text;
  }

  function countTimestampLines(lines) {
    return lines.filter((line) => hasTimestampText(line)).length;
  }

  function getTimestampLinkVideoId(link) {
    const url = new URL(link.href, location.href);
    const linkedVideoId = url.searchParams.get("v");
    if (!linkedVideoId) {
      return "";
    }

    const timeParamStart = parseTimeParam(url.searchParams.get("t"));
    const textStart = parseTimestampText(link.textContent);
    return Number.isFinite(timeParamStart) || Number.isFinite(textStart) ? linkedVideoId : "";
  }

  function getTimestampCandidateRoots() {
    const selectors = [
      ...getQuietDescriptionSelectors(),
      "ytd-watch-metadata #description-inline-expander #expanded",
      "ytd-watch-metadata #description-inline-expander",
      "ytd-watch-metadata #description",
    ];

    return getUniqueElements(selectors);
  }

  function getDomCommentSourceResults(session, duration, observation, status) {
    const results = [];
    let regularCommentCount = 0;

    for (const [order, root] of getCommentRoots().entries()) {
      const ownership = getDomSourceOwnership(root, session.videoId);
      if (!ownership) {
        continue;
      }

      const sourceType = getCommentSourceType(root);
      if (sourceType === COMMENT_SOURCE_TYPES.REGULAR) {
        regularCommentCount += 1;
        if (regularCommentCount > REGULAR_COMMENT_SCAN_LIMIT) {
          continue;
        }
      }

      const sourceId = getDomSourceId(session, root);
      const candidates = getTextTimestampCandidates(getCommentBodyText(root), `comment:${sourceId}`);
      const tracks = findTracks(duration, candidates, COMMENT_MIN_TRACKS);
      if (tracks.length < COMMENT_MIN_TRACKS) {
        continue;
      }

      const scoredSource = {
        duration,
        likeCount: getCommentLikeCount(root),
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
    if (records.length > 0 || discovery.records.length === 0) {
      discovery.records = records;
    }
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
    const bestResult = getBestFetchedCommentResult(
      session,
      discovery.records,
      duration,
      sourceStatus
    );
    if (bestResult) {
      discovery.result = bestResult;
    }
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

    const ownerName = normalizeChannelName(getVideoOwnerName());
    const authorName = normalizeChannelName(record.authorName);
    if (record.isUploader || (ownerName && authorName && ownerName === authorName)) {
      return COMMENT_SOURCE_TYPES.UPLOADER;
    }

    return COMMENT_SOURCE_TYPES.REGULAR;
  }

  function getCommentRoots() {
    const roots = [];
    for (const thread of document.querySelectorAll("ytd-comment-thread-renderer")) {
      addUniqueElement(roots, thread.querySelector("ytd-comment-view-model, ytd-comment-renderer") || thread);
    }

    for (const comment of document.querySelectorAll("ytd-comment-view-model, ytd-comment-renderer")) {
      if (!comment.closest("ytd-comment-thread-renderer")) {
        addUniqueElement(roots, comment);
      }
    }

    return roots.filter(isVisible);
  }

  function addUniqueElement(elements, element) {
    if (element && !elements.includes(element)) {
      elements.push(element);
    }
  }

  function getCommentSourceType(root) {
    if (isPinnedComment(root)) {
      return COMMENT_SOURCE_TYPES.PINNED;
    }

    if (isUploaderComment(root)) {
      return COMMENT_SOURCE_TYPES.UPLOADER;
    }

    return COMMENT_SOURCE_TYPES.REGULAR;
  }

  function isPinnedComment(root) {
    if (root.querySelector("ytd-pinned-comment-badge-renderer, #pinned-comment-badge, [id*='pinned-comment']")) {
      return true;
    }

    return normalizeTitleText(root.textContent).toLowerCase().includes("pinned by");
  }

  function isUploaderComment(root) {
    const authorBadge = root.querySelector("ytd-author-comment-badge-renderer, #author-comment-badge, [id*='author-comment-badge']");
    if (authorBadge && isVisible(authorBadge)) {
      return true;
    }

    const ownerName = normalizeChannelName(getVideoOwnerName());
    const authorName = normalizeChannelName(getCommentAuthorName(root));
    return Boolean(ownerName && authorName && ownerName === authorName);
  }

  function getVideoOwnerName() {
    const selectors = [
      "ytd-watch-metadata ytd-video-owner-renderer #channel-name #text",
      "ytd-watch-metadata ytd-video-owner-renderer #channel-name a",
      "ytd-watch-metadata #owner #channel-name #text",
      "ytd-watch-metadata #owner a.yt-simple-endpoint",
      "#upload-info #channel-name #text",
      "#upload-info #channel-name a",
    ];

    return getFirstVisibleText(selectors);
  }

  function getCommentAuthorName(root) {
    const selectors = [
      "#author-text",
      "#author-text span",
      "a#author-text",
      "h3 a",
      "a[href^='/@']",
      "a[href*='/channel/']",
    ];

    for (const selector of selectors) {
      const element = root.querySelector(selector);
      if (element && isVisible(element)) {
        const text = normalizeTitleText(element.textContent);
        if (text) {
          return text;
        }
      }
    }

    return "";
  }

  function getFirstVisibleText(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && isVisible(element)) {
        const text = normalizeTitleText(element.textContent);
        if (text) {
          return text;
        }
      }
    }

    return "";
  }

  function normalizeChannelName(text) {
    return normalizeTitleText(text)
      .replace(/^@/, "")
      .toLowerCase();
  }

  function getCommentBodyText(root) {
    const bodySelectors = [
      "#content-text",
      "yt-attributed-string#content-text",
      "yt-formatted-string#content-text",
    ];

    for (const selector of bodySelectors) {
      const element = root.querySelector(selector);
      if (element && isVisible(element)) {
        const text = element.innerText || element.textContent || "";
        if (normalizeTitleText(text)) {
          return text;
        }
      }
    }

    return root.innerText || root.textContent || "";
  }

  function getCommentLikeCount(root) {
    const voteCount = root.querySelector("#vote-count-middle, [id='vote-count-middle']");
    if (voteCount && isVisible(voteCount)) {
      const parsedVoteCount = parseCommentLikeCount(voteCount.textContent || "");
      if (parsedVoteCount !== null) {
        return parsedVoteCount;
      }
    }

    for (const element of root.querySelectorAll("[aria-label]")) {
      if (!isVisible(element)) {
        continue;
      }

      const label = element.getAttribute("aria-label") || "";
      if (!/\blike/i.test(label)) {
        continue;
      }

      const parsedLabelCount = parseCommentLikeCount(label);
      if (parsedLabelCount !== null) {
        return parsedLabelCount;
      }
    }

    return null;
  }

  function canReadQuietDescription(videoId) {
    return getUniqueElements(getQuietDescriptionSelectors()).some((root) => {
      if (!getDomSourceOwnership(root, videoId)) {
        return false;
      }

      const text = removeNativeTimestampSections(root.textContent || "");
      const normalizedText = normalizeTitleText(text);
      return normalizedText.length > 0 && !isLikelyCollapsedDescriptionTextRoot(root, normalizedText);
    });
  }

  function getQuietDescriptionSelectors() {
    return [
      "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-structured-description'] ytd-expandable-video-description-body-renderer",
      "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-structured-description'] ytd-structured-description-content-renderer",
      "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-structured-description']",
    ];
  }

  function getUniqueElements(selectors) {
    const roots = [];
    for (const selector of selectors) {
      for (const root of document.querySelectorAll(selector)) {
        if (!roots.includes(root)) {
          roots.push(root);
        }
      }
    }

    return roots;
  }

  function toTimestampCandidate(link, videoId) {
    const url = new URL(link.href, location.href);
    const linkedVideoId = url.searchParams.get("v");
    if (linkedVideoId && linkedVideoId !== videoId) {
      return null;
    }

    const timeParamStart = parseTimeParam(url.searchParams.get("t"));
    const start = Number.isFinite(timeParamStart) ? timeParamStart : parseTimestampText(link.textContent);
    if (!Number.isFinite(start)) {
      return null;
    }

    const timestampText = link.textContent.trim();
    const lineText = getTimestampLineText(link);
    if (isTimestampRangeEndMarker(lineText, timestampText)) {
      return null;
    }

    return {
      start,
      timestampText,
      title: cleanTrackTitle(extractTrackTitle(link, lineText)),
      lineKey: normalizeTitleText(lineText),
    };
  }

  function extractTrackTitle(link, lineText = getTimestampLineText(link)) {
    const timestamp = link.textContent.trim();
    const lineTitle = titleFromLineFragment(lineText, timestamp);
    if (lineTitle) {
      return lineTitle;
    }

    const inlineText = collectTextAfterTimestampLink(link);
    return titleFromLineFragment(inlineText, timestamp);
  }

  function getTimestampLineText(link) {
    const container = link.closest(".ytAttributedStringHost, yt-attributed-string, #description, div, li, p");
    const startNode = link.closest(".ytAttributedStringLinkInheritColor") || link;
    const nodeLineText = getLineTextForNode(container, startNode);
    if (nodeLineText) {
      return nodeLineText;
    }

    const text = container?.innerText || container?.textContent || "";
    return lineContainingTimestamp(text, link.textContent.trim());
  }

  function getLineTextForNode(container, targetNode) {
    if (!container || !targetNode || !container.contains(targetNode)) {
      return "";
    }

    let text = "";
    let targetOffset = -1;

    function visit(node) {
      if (node === targetNode) {
        targetOffset = text.length;
      }

      if (node.nodeType === Node.TEXT_NODE) {
        text += node.nodeValue || "";
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return;
      }

      if (node.tagName === "BR") {
        text += "\n";
        return;
      }

      for (const child of node.childNodes) {
        visit(child);
      }
    }

    visit(container);
    if (targetOffset === -1) {
      return "";
    }

    const lineStart = text.lastIndexOf("\n", Math.max(0, targetOffset - 1)) + 1;
    const lineEnd = text.indexOf("\n", targetOffset);
    return text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
  }

  function collectTextAfterTimestampLink(link) {
    const container = link.closest(".ytAttributedStringHost, yt-attributed-string, #description, div, li, p");
    const startNode = link.closest(".ytAttributedStringLinkInheritColor") || link;
    if (!container || !container.contains(startNode)) {
      return "";
    }

    let collecting = false;
    let text = "";

    function visit(node) {
      if (node === startNode) {
        collecting = true;
        return false;
      }

      if (collecting && node.nodeType === Node.ELEMENT_NODE && node.matches("a")) {
        return true;
      }

      if (collecting && node.nodeType === Node.TEXT_NODE) {
        text += node.nodeValue;
        return false;
      }

      if (collecting && node.nodeType === Node.ELEMENT_NODE && node.tagName === "BR") {
        text += "\n";
        return false;
      }

      for (const child of node.childNodes) {
        if (visit(child)) {
          return true;
        }
      }

      return false;
    }

    visit(container);
    return text;
  }

  function ensureUi() {
    root = document.getElementById(ROOT_ID);
    if (root) {
      return;
    }

    root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML = `
      <div class="ts-drag-handle" aria-hidden="true"></div>
      <div class="ts-resize-handle" aria-hidden="true"></div>
      <button class="ts-compact-toggle" type="button" aria-label="Compact player" title="Compact player">
        <svg class="ts-icon ts-stroke-icon ts-compact-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9l6 6 6-6"></path>
        </svg>
        <svg class="ts-icon ts-stroke-icon ts-expand-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 15l6-6 6 6"></path>
        </svg>
      </button>
      <button class="ts-popout" type="button" aria-label="Pop out player" title="Pop out player">
        <svg class="ts-icon ts-stroke-icon ts-popout-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"></path>
          <path d="M14 4h6v6"></path>
          <path d="M20 4 11 13"></path>
        </svg>
        <svg class="ts-icon ts-stroke-icon ts-dock-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"></path>
          <path d="M8 9h8"></path>
          <path d="M8 13h5"></path>
        </svg>
      </button>
      <button class="ts-close" type="button" aria-label="Close player" title="Close player">
        <svg class="ts-icon ts-stroke-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6l12 12"></path>
          <path d="M18 6 6 18"></path>
        </svg>
      </button>
      <div class="ts-body">
        <div class="ts-now-playing">
          <div class="ts-count"></div>
          <div class="ts-track">No track selected</div>
        </div>
        <div class="ts-progress">
          <div class="ts-progress-times">
            <span class="ts-progress-elapsed">0:00</span>
            <span class="ts-progress-remaining" role="button" aria-pressed="false">-0:00</span>
          </div>
          <div class="ts-progress-slider" aria-label="Seek within current track" aria-disabled="false">
            <div class="ts-progress-fill"></div>
            <div class="ts-progress-thumb"></div>
          </div>
        </div>
        <div class="ts-controls" aria-label="Player controls">
          <button class="ts-icon-button ts-toggle" type="button" aria-label="Turn shuffle on" title="Shuffle">
            <svg class="ts-icon ts-stroke-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M2 18h1.4c1.3 0 2.5-.7 3.2-1.8l4.8-8.4C12.1 6.7 13.3 6 14.6 6H22"></path>
              <path d="M18 2l4 4-4 4"></path>
              <path d="M2 6h1.4c1.3 0 2.5.7 3.2 1.8l1.1 1.9"></path>
              <path d="M12.4 14.3l1 1.9c.7 1.1 1.9 1.8 3.2 1.8H22"></path>
              <path d="M18 14l4 4-4 4"></path>
            </svg>
          </button>
          <button class="ts-icon-button ts-previous" type="button" aria-label="Previous track" title="Previous track">
            <svg class="ts-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 5h2v14H5zM10 12l9 7V5z"></path>
            </svg>
          </button>
          <button class="ts-icon-button ts-play-pause" type="button" aria-label="Play" title="Play">
            <svg class="ts-icon ts-play-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5v14l11-7z"></path>
            </svg>
            <svg class="ts-icon ts-pause-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 5h4v14H7zM13 5h4v14h-4z"></path>
            </svg>
          </button>
          <button class="ts-icon-button ts-next" type="button" aria-label="Next track" title="Next track">
            <svg class="ts-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 5v14l9-7zM17 5h2v14h-2z"></path>
            </svg>
          </button>
          <button class="ts-icon-button ts-repeat" type="button" aria-label="Turn repeat on" title="Repeat current track">
            <svg class="ts-icon ts-stroke-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M17 2l4 4-4 4"></path>
              <path d="M3 11V9a3 3 0 0 1 3-3h15"></path>
              <path d="M7 22l-4-4 4-4"></path>
              <path d="M21 13v2a3 3 0 0 1-3 3H3"></path>
              <text class="ts-repeat-one" x="12" y="14">1</text>
            </svg>
          </button>
        </div>
        <div class="ts-list" aria-label="Tracks"></div>
      </div>
    `;
    document.documentElement.append(root);

    dragHandle = root.querySelector(".ts-drag-handle");
    resizeHandle = root.querySelector(".ts-resize-handle");
    compactButton = root.querySelector(".ts-compact-toggle");
    popoutButton = root.querySelector(".ts-popout");
    closeButton = root.querySelector(".ts-close");
    trackEl = root.querySelector(".ts-track");
    countEl = root.querySelector(".ts-count");
    progressElapsedEl = root.querySelector(".ts-progress-elapsed");
    progressRemainingEl = root.querySelector(".ts-progress-remaining");
    progressSlider = root.querySelector(".ts-progress-slider");
    listEl = root.querySelector(".ts-list");
    trackListRenderer = createTrackListRenderer({
      document,
      formatTimestamp,
      formatTrackLabel,
      listElement: listEl,
    });
    previousButton = root.querySelector(".ts-previous");
    playPauseButton = root.querySelector(".ts-play-pause");
    toggleButton = root.querySelector(".ts-toggle");
    repeatButton = root.querySelector(".ts-repeat");
    nextButton = root.querySelector(".ts-next");

    root.addEventListener("mousedown", preventMouseButtonFocus);
    dragHandle.addEventListener("pointerdown", handleDragPointerDown);
    resizeHandle.addEventListener("pointerdown", handleResizePointerDown);
    compactButton.addEventListener("click", toggleAnchoredCompact);
    popoutButton.addEventListener("click", togglePanelMode);
    closeButton.addEventListener("click", closePlayer);
    trackEl.addEventListener("click", scrollCurrentTrackIntoView);
    previousButton.addEventListener("click", playPreviousTrack);
    playPauseButton.addEventListener("click", togglePlayPause);
    toggleButton.addEventListener("click", toggleShuffle);
    repeatButton.addEventListener("click", toggleRepeat);
    nextButton.addEventListener("click", playNextTrack);
    progressSlider.addEventListener("pointerdown", handleProgressPointerDown);
    progressRemainingEl.addEventListener("pointerdown", (event) => event.preventDefault());
    progressRemainingEl.addEventListener("click", toggleProgressTimeMode);
    listEl.addEventListener("click", handleTrackListClick);
  }

  function preventMouseButtonFocus(event) {
    if (event.button !== 0) {
      return;
    }

    const button = event.target.closest?.("button");
    if (!button || !event.currentTarget.contains(button)) {
      return;
    }

    event.preventDefault();
  }

  function closePlayer() {
    state.panelOpen = false;
    if (state.session) {
      state.session.userClosedPanel = true;
    }
    updateUi();
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
      const rect = root.getBoundingClientRect();
      state.panelMode = PANEL_MODES.FLOATING;
      state.playerPosition = clampPlayerPosition(rect.left, rect.top, rect.width, rect.height);
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

  function mountPlayerForMode(inlineCompact) {
    if (inlineCompact) {
      movePlayerToOverlayRoot();
      removeEmptyCompactHost();
      clearPlayerSize();
      clearRootPosition();
      return true;
    }

    movePlayerToOverlayRoot();
    return false;
  }

  function movePlayerToOverlayRoot() {
    if (root && root.parentElement !== document.documentElement) {
      document.documentElement.append(root);
    }
  }

  function removeEmptyCompactHost() {
    if (compactHost?.isConnected && !compactHost.contains(root)) {
      compactHost.remove();
    }
  }

  function handleDragPointerDown(event) {
    if (state.panelMode !== PANEL_MODES.FLOATING) {
      return;
    }

    if (event.button !== undefined && event.button !== 0) {
      return;
    }

    event.preventDefault();
    const rect = root.getBoundingClientRect();
    dragPointerId = event.pointerId;
    dragOffsetX = event.clientX - rect.left;
    dragOffsetY = event.clientY - rect.top;
    root.classList.add("is-dragging");
    dragHandle.setPointerCapture?.(event.pointerId);
    dragHandle.addEventListener("pointermove", handleDragPointerMove);
    dragHandle.addEventListener("pointerup", handleDragPointerEnd, { once: true });
    dragHandle.addEventListener("pointercancel", handleDragPointerEnd, { once: true });
    positionPlayer(event.clientX - dragOffsetX, event.clientY - dragOffsetY);
  }

  function handleDragPointerMove(event) {
    if (event.pointerId !== dragPointerId) {
      return;
    }

    event.preventDefault();
    positionPlayer(event.clientX - dragOffsetX, event.clientY - dragOffsetY);
  }

  function handleDragPointerEnd(event) {
    if (dragPointerId !== null && event.pointerId !== dragPointerId) {
      return;
    }

    dragHandle.releasePointerCapture?.(event.pointerId);
    dragPointerId = null;
    root.classList.remove("is-dragging");
    dragHandle.removeEventListener("pointermove", handleDragPointerMove);
    dragHandle.removeEventListener("pointerup", handleDragPointerEnd);
    dragHandle.removeEventListener("pointercancel", handleDragPointerEnd);
    saveFloatingPlayerLayout();
  }

  function positionPlayer(left, top) {
    const rect = root.getBoundingClientRect();
    const nextPosition = clampPlayerPosition(left, top, rect.width, rect.height);

    applyPlayerPosition(nextPosition);
  }

  function schedulePlayerLayout() {
    if (!state.panelOpen || !root?.classList.contains("is-visible") || state.playerLayoutFrame) {
      return;
    }

    state.playerLayoutFrame = requestAnimationFrame(() => {
      state.playerLayoutFrame = null;
      layoutPlayer();
    });
  }

  function layoutPlayer() {
    if (!root?.classList.contains("is-visible")) {
      return;
    }

    if (root.classList.contains("is-inline-compact")) {
      if (!positionCompactPlayer() && !mountCompactFallback()) {
        positionAnchoredPlayer();
      }
      return;
    }

    if (state.panelMode === PANEL_MODES.ANCHORED) {
      positionAnchoredPlayer();
      return;
    }

    positionFloatingPlayer();
  }

  function positionFloatingPlayer() {
    if (state.playerSize) {
      applyPlayerSize(clampPlayerSize(state.playerSize.width, state.playerSize.height));
    } else {
      clearPlayerSize();
    }

    if (state.playerPosition) {
      positionPlayer(state.playerPosition.left, state.playerPosition.top);
      return;
    }

    const rect = root.getBoundingClientRect();
    const viewport = getViewportSize();
    const position = clampPlayerPosition(
      viewport.width - rect.width - 18,
      viewport.height - rect.height - 88,
      rect.width,
      rect.height
    );
    applyPlayerPosition(position);
  }

  function positionAnchoredPlayer() {
    const anchorRect = launcherButton?.isConnected ? launcherButton.getBoundingClientRect() : null;
    const alignmentRect = findCompactActionAnchor()?.getBoundingClientRect() || anchorRect;

    if (state.anchoredWidth || state.anchoredHeight) {
      const currentRect = root.getBoundingClientRect();
      renderAnchoredPlayerSize(
        clampAnchoredPlayerSize(
          state.anchoredWidth ?? currentRect.width,
          state.anchoredHeight ?? currentRect.height,
          alignmentRect
        )
      );
    } else {
      clearPlayerSize();
    }

    const rect = root.getBoundingClientRect();
    const viewport = getViewportSize();
    const fallbackLeft = viewport.width - rect.width - 18;
    const fallbackTop = viewport.height - rect.height - 88;

    if (!anchorRect || anchorRect.width <= 0 || anchorRect.height <= 0) {
      applyRootPosition(clampPlayerPosition(fallbackLeft, fallbackTop, rect.width, rect.height));
      return;
    }

    const scrollOffset = getViewportScrollOffset();
    applyRootPosition(
      {
        left: alignmentRect.right + scrollOffset.left - rect.width,
        top: anchorRect.top + scrollOffset.top - rect.height - DRAG_VIEWPORT_PADDING,
      },
      "absolute"
    );
  }

  function positionCompactPlayer() {
    movePlayerToOverlayRoot();
    removeEmptyCompactHost();

    const actionAnchor = findCompactActionAnchor();
    const actionRect = actionAnchor?.getBoundingClientRect();

    if (state.compactWidth) {
      renderCompactPlayerWidth(clampCompactPlayerWidth(state.compactWidth, actionRect));
    } else {
      clearPlayerSize();
    }

    const rect = root.getBoundingClientRect();

    if (!actionRect || actionRect.width <= 0 || actionRect.height <= 0 || rect.width <= 0 || rect.height <= 0) {
      clearRootPosition();
      return false;
    }

    const scrollOffset = getViewportScrollOffset();
    const viewport = getViewportSize();
    const minLeft = DRAG_VIEWPORT_PADDING;
    const maxLeft = Math.max(minLeft, viewport.width - rect.width - DRAG_VIEWPORT_PADDING);
    const left = clamp(actionRect.right - rect.width, minLeft, maxLeft) + scrollOffset.left;
    const top = Math.max(0, actionRect.top + scrollOffset.top - rect.height - 6);

    applyRootPosition({ left, top }, "absolute");
    return true;
  }

  function mountCompactFallback() {
    const actionRow = findActionRow();
    if (!actionRow) {
      return false;
    }

    ensureCompactHost(actionRow);
    if (!compactHost?.isConnected) {
      return false;
    }

    if (root.parentElement !== compactHost) {
      compactHost.append(root);
    }

    if (state.compactWidth) {
      renderCompactPlayerWidth(clampCompactPlayerWidth(state.compactWidth));
    } else {
      clearPlayerSize();
    }

    clearRootPosition();
    return true;
  }

  function applyPlayerPosition(position) {
    state.playerPosition = position;
    applyRootPosition(position);
  }

  function applyRootPosition(position, positionMode = "fixed") {
    root.style.position = positionMode;
    root.style.left = `${position.left}px`;
    root.style.top = `${position.top}px`;
    root.style.right = "auto";
    root.style.bottom = "auto";
  }

  function clearRootPosition() {
    root.style.position = "";
    root.style.left = "";
    root.style.top = "";
    root.style.right = "";
    root.style.bottom = "";
  }

  function applyPlayerSize(size) {
    state.playerSize = size;
    root.classList.add("has-custom-size");
    root.style.width = `${size.width}px`;
    root.style.height = `${size.height}px`;
  }

  function clearPlayerSize() {
    root.classList.remove("has-custom-size");
    root.style.width = "";
    root.style.height = "";
  }

  function applyAnchoredPlayerSize(size) {
    state.anchoredWidth = size.width;
    state.anchoredHeight = size.height;
    renderAnchoredPlayerSize(size);
  }

  function renderAnchoredPlayerSize(size) {
    root.classList.add("has-custom-size");
    root.style.width = `${size.width}px`;
    root.style.height = `${size.height}px`;
  }

  function applyCompactPlayerWidth(width) {
    state.compactWidth = width;
    renderCompactPlayerWidth(width);
  }

  function renderCompactPlayerWidth(width) {
    root.classList.remove("has-custom-size");
    root.style.width = `${width}px`;
    root.style.height = "";
  }

  function saveFloatingPlayerLayout() {
    saveSettings({
      floatingPlayerPosition: state.playerPosition,
      floatingPlayerSize: state.playerSize,
    });
  }

  function saveAnchoredPlayerLayout() {
    saveSettings({
      anchoredPlayerSize: state.anchoredWidth && state.anchoredHeight
        ? { width: state.anchoredWidth, height: state.anchoredHeight }
        : null,
    });
  }

  function saveCompactPlayerLayout() {
    saveSettings({ compactPlayerWidth: state.compactWidth });
  }

  function clampPlayerPosition(left, top, width, height) {
    const viewport = getViewportSize();
    const maxLeft = Math.max(DRAG_VIEWPORT_PADDING, viewport.width - width - DRAG_VIEWPORT_PADDING);
    const maxTop = Math.max(DRAG_VIEWPORT_PADDING, viewport.height - height - DRAG_VIEWPORT_PADDING);

    return {
      left: clamp(left, DRAG_VIEWPORT_PADDING, maxLeft),
      top: clamp(top, DRAG_VIEWPORT_PADDING, maxTop),
    };
  }

  function clampPlayerSize(width, height, anchorPosition = null) {
    const viewport = getViewportSize();
    const maxViewportWidth = viewport.width - DRAG_VIEWPORT_PADDING * 2;
    const maxViewportHeight = viewport.height - DRAG_VIEWPORT_PADDING * 2;
    const maxAnchoredWidth = anchorPosition
      ? viewport.width - anchorPosition.left - DRAG_VIEWPORT_PADDING
      : maxViewportWidth;
    const maxAnchoredHeight = anchorPosition
      ? viewport.height - anchorPosition.top - DRAG_VIEWPORT_PADDING
      : maxViewportHeight;
    const maxWidth = Math.max(PLAYER_MIN_VISIBLE_WIDTH, Math.min(maxViewportWidth, maxAnchoredWidth));
    const maxHeight = Math.max(PLAYER_MIN_VISIBLE_HEIGHT, Math.min(maxViewportHeight, maxAnchoredHeight));

    return {
      width: clamp(width, Math.min(PLAYER_MIN_WIDTH, maxWidth), maxWidth),
      height: clamp(height, Math.min(PLAYER_MIN_HEIGHT, maxHeight), maxHeight),
    };
  }

  function clampTopLeftResizeSize(width, height, right, bottom) {
    const viewport = getViewportSize();
    const maxViewportWidth = viewport.width - DRAG_VIEWPORT_PADDING * 2;
    const maxViewportHeight = viewport.height - DRAG_VIEWPORT_PADDING * 2;
    const maxWidth = Math.max(
      PLAYER_MIN_VISIBLE_WIDTH,
      Math.min(maxViewportWidth, right - DRAG_VIEWPORT_PADDING)
    );
    const maxHeight = Math.max(
      PLAYER_MIN_VISIBLE_HEIGHT,
      Math.min(maxViewportHeight, bottom - DRAG_VIEWPORT_PADDING)
    );

    return {
      width: clamp(width, Math.min(PLAYER_MIN_WIDTH, maxWidth), maxWidth),
      height: clamp(height, Math.min(PLAYER_MIN_HEIGHT, maxHeight), maxHeight),
    };
  }

  function clampAnchoredPlayerWidth(width, alignmentRect = null) {
    const viewport = getViewportSize();
    const maxViewportWidth = viewport.width - DRAG_VIEWPORT_PADDING * 2;
    const alignmentRight = alignmentRect?.right ?? viewport.width - DRAG_VIEWPORT_PADDING;
    const maxAnchoredWidth = alignmentRight - DRAG_VIEWPORT_PADDING;
    const maxWidth = Math.max(PLAYER_MIN_VISIBLE_WIDTH, Math.min(maxViewportWidth, maxAnchoredWidth));

    return clamp(width, Math.min(PLAYER_MIN_WIDTH, maxWidth), maxWidth);
  }

  function clampCompactPlayerWidth(width, alignmentRect = null) {
    const viewport = getViewportSize();
    const maxViewportWidth = viewport.width - DRAG_VIEWPORT_PADDING * 2;
    const alignmentRight = alignmentRect?.right ?? viewport.width - DRAG_VIEWPORT_PADDING;
    const maxCompactWidth = alignmentRight - DRAG_VIEWPORT_PADDING;
    const maxWidth = Math.max(PLAYER_MIN_VISIBLE_WIDTH, Math.min(maxViewportWidth, maxCompactWidth));

    return clamp(width, Math.min(COMPACT_PLAYER_MIN_WIDTH, maxWidth), maxWidth);
  }

  function clampAnchoredPlayerSize(width, height, alignmentRect = null, anchorRect = null) {
    const viewport = getViewportSize();
    const maxViewportHeight = viewport.height - DRAG_VIEWPORT_PADDING * 2;
    const maxAnchoredHeight = anchorRect
      ? anchorRect.top - DRAG_VIEWPORT_PADDING * 2
      : maxViewportHeight;
    const maxHeight = Math.max(PLAYER_MIN_VISIBLE_HEIGHT, Math.min(maxViewportHeight, maxAnchoredHeight));

    return {
      width: clampAnchoredPlayerWidth(width, alignmentRect),
      height: clamp(height, Math.min(PLAYER_MIN_HEIGHT, maxHeight), maxHeight),
    };
  }

  function getViewportSize() {
    return {
      width: window.visualViewport?.width ?? window.innerWidth,
      height: window.visualViewport?.height ?? window.innerHeight,
    };
  }

  function getViewportScrollOffset() {
    return {
      left: window.scrollX || window.pageXOffset || 0,
      top: window.scrollY || window.pageYOffset || 0,
    };
  }

  function handleResizePointerDown(event) {
    const isAnchoredResize = state.panelMode === PANEL_MODES.ANCHORED && !state.anchoredCompact;
    const isCompactResize = state.panelMode === PANEL_MODES.ANCHORED && state.anchoredCompact;

    if (state.panelMode !== PANEL_MODES.FLOATING && !isAnchoredResize && !isCompactResize) {
      return;
    }

    if (event.button !== undefined && event.button !== 0) {
      return;
    }

    event.preventDefault();
    const rect = root.getBoundingClientRect();
    const alignmentRect = findCompactActionAnchor()?.getBoundingClientRect()
      || (launcherButton?.isConnected ? launcherButton.getBoundingClientRect() : null);
    const anchorRect = launcherButton?.isConnected ? launcherButton.getBoundingClientRect() : null;
    let size;
    if (isAnchoredResize) {
      size = clampAnchoredPlayerSize(rect.width, rect.height, alignmentRect, anchorRect);
    } else if (isCompactResize) {
      size = { width: clampCompactPlayerWidth(rect.width, alignmentRect), height: rect.height };
    } else {
      size = clampPlayerSize(rect.width, rect.height);
    }
    const position = clampPlayerPosition(rect.left, rect.top, size.width, size.height);

    resizePointerId = event.pointerId;
    if (isAnchoredResize) {
      resizeMode = RESIZE_MODES.ANCHORED;
    } else if (isCompactResize) {
      resizeMode = RESIZE_MODES.COMPACT_WIDTH;
    } else {
      resizeMode = RESIZE_MODES.FLOATING;
    }
    resizeStartX = event.clientX;
    resizeStartY = event.clientY;
    resizeStartWidth = size.width;
    resizeStartHeight = size.height;
    resizeStartLeft = position.left;
    resizeStartTop = position.top;

    if (resizeMode === RESIZE_MODES.ANCHORED) {
      applyAnchoredPlayerSize(size);
      layoutPlayer();
    } else if (resizeMode === RESIZE_MODES.COMPACT_WIDTH) {
      applyCompactPlayerWidth(size.width);
      layoutPlayer();
    } else {
      applyPlayerPosition(position);
      applyPlayerSize(size);
    }

    root.classList.add("is-resizing");
    resizeHandle.setPointerCapture?.(event.pointerId);
    resizeHandle.addEventListener("pointermove", handleResizePointerMove);
    resizeHandle.addEventListener("pointerup", handleResizePointerEnd, { once: true });
    resizeHandle.addEventListener("pointercancel", handleResizePointerEnd, { once: true });
  }

  function handleResizePointerMove(event) {
    if (event.pointerId !== resizePointerId) {
      return;
    }

    event.preventDefault();
    if (resizeMode === RESIZE_MODES.ANCHORED) {
      const alignmentRect = findCompactActionAnchor()?.getBoundingClientRect()
        || (launcherButton?.isConnected ? launcherButton.getBoundingClientRect() : null);
      const anchorRect = launcherButton?.isConnected ? launcherButton.getBoundingClientRect() : null;
      applyAnchoredPlayerSize(
        clampAnchoredPlayerSize(
          resizeStartWidth + resizeStartX - event.clientX,
          resizeStartHeight + resizeStartY - event.clientY,
          alignmentRect,
          anchorRect
        )
      );
      layoutPlayer();
      return;
    }

    if (resizeMode === RESIZE_MODES.COMPACT_WIDTH) {
      const alignmentRect = findCompactActionAnchor()?.getBoundingClientRect()
        || (launcherButton?.isConnected ? launcherButton.getBoundingClientRect() : null);
      applyCompactPlayerWidth(
        clampCompactPlayerWidth(resizeStartWidth + resizeStartX - event.clientX, alignmentRect)
      );
      layoutPlayer();
      return;
    }

    const resizeStartRight = resizeStartLeft + resizeStartWidth;
    const resizeStartBottom = resizeStartTop + resizeStartHeight;
    const size = clampTopLeftResizeSize(
      resizeStartWidth + resizeStartX - event.clientX,
      resizeStartHeight + resizeStartY - event.clientY,
      resizeStartRight,
      resizeStartBottom
    );

    applyPlayerPosition({
      left: resizeStartRight - size.width,
      top: resizeStartBottom - size.height,
    });
    applyPlayerSize(size);
    layoutPlayer();
  }

  function handleResizePointerEnd(event) {
    if (resizePointerId !== null && event.pointerId !== resizePointerId) {
      return;
    }

    const completedResizeMode = resizeMode;
    resizeHandle.releasePointerCapture?.(event.pointerId);
    resizePointerId = null;
    resizeMode = null;
    root.classList.remove("is-resizing");
    resizeHandle.removeEventListener("pointermove", handleResizePointerMove);
    resizeHandle.removeEventListener("pointerup", handleResizePointerEnd);
    resizeHandle.removeEventListener("pointercancel", handleResizePointerEnd);

    if (completedResizeMode === RESIZE_MODES.ANCHORED) {
      saveAnchoredPlayerLayout();
    } else if (completedResizeMode === RESIZE_MODES.COMPACT_WIDTH) {
      saveCompactPlayerLayout();
    } else if (completedResizeMode === RESIZE_MODES.FLOATING) {
      saveFloatingPlayerLayout();
    }
  }

  function togglePlayPause() {
    const video = getVideo();
    if (!video) {
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
    state.playback = togglePlaybackShuffle(state.playback, state.tracks.length);
    updateUi();
  }

  function toggleRepeat() {
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
    const currentIndex = state.playback.shuffleEnabled && options.currentIndex !== undefined
      ? options.currentIndex
      : getEffectiveCurrentTrackIndex();
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
    const video = getVideo();
    if (!video || !state.tracks.length) {
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
    const video = getVideo();
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
    const video = getVideo();
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

  function handleProgressPointerDown(event) {
    if (progressSlider.getAttribute("aria-disabled") === "true") {
      return;
    }

    if (event.button !== undefined && event.button !== 0) {
      return;
    }

    event.preventDefault();
    progressSlider.classList.add("is-scrubbing");
    seekProgressFromPointer(event);
    progressSlider.setPointerCapture?.(event.pointerId);
    progressSlider.addEventListener("pointermove", handleProgressPointerMove);
    progressSlider.addEventListener("pointerup", handleProgressPointerEnd, { once: true });
    progressSlider.addEventListener("pointercancel", handleProgressPointerEnd, { once: true });
  }

  function handleProgressPointerMove(event) {
    if (event.buttons === 0) {
      handleProgressPointerEnd(event);
      return;
    }

    event.preventDefault();
    seekProgressFromPointer(event);
  }

  function handleProgressPointerEnd(event) {
    progressSlider.releasePointerCapture?.(event.pointerId);
    progressSlider.classList.remove("is-scrubbing");
    progressSlider.removeEventListener("pointermove", handleProgressPointerMove);
    progressSlider.removeEventListener("pointerup", handleProgressPointerEnd);
    progressSlider.removeEventListener("pointercancel", handleProgressPointerEnd);
  }

  function seekProgressFromPointer(event) {
    const video = getVideo();
    const track = getProgressTrack(video);
    if (!video || !track) {
      updateProgress(video);
      return;
    }

    const rect = progressSlider.getBoundingClientRect();
    const progress = rect.width > 0 ? clamp((event.clientX - rect.left) / rect.width, 0, 1) : 0;
    const duration = getTrackDuration(track);
    video.currentTime = track.start + duration * progress;
    state.currentTrackIndex = track.index;
    updateProgress(video);
  }

  function handleTimeUpdate(event) {
    if (event.target !== getVideo()) {
      return;
    }

    if (!tracksBelongToVideo()) {
      updateUi();
      return;
    }

    const video = event.target;
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

  function handlePlaybackStateChange(event) {
    if (event.target === getVideo()) {
      updateUi();
    }
  }

  function handleFullscreenChange() {
    updateUi();
    schedulePlayerLayout();
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

    const item = listEl.querySelector(`[data-index="${currentIndex}"]`);
    if (!item) {
      return;
    }

    const listRect = listEl.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const targetTop = listEl.scrollTop + itemRect.top - listRect.top;

    listEl.scrollTo({
      top: Math.max(0, targetTop),
      behavior: "smooth",
    });
  }

  function renderTrackList() {
    trackListRenderer.renderCollection(state.tracks);
    trackListRenderer.renderActive(state.currentTrackIndex);
  }

  function updateProgress(video = getVideo()) {
    const track = getProgressTrack(video);
    if (!video || !track) {
      progressElapsedEl.textContent = "0:00";
      updateProgressRightTime("0:00", "0:00");
      progressSlider.style.setProperty("--ts-progress", "0%");
      progressSlider.removeAttribute("title");
      return;
    }

    const duration = getTrackDuration(track);
    const elapsed = clamp(video.currentTime - track.start, 0, duration);
    const remaining = Math.max(0, duration - elapsed);
    const progress = duration > 0 ? elapsed / duration : 0;
    const elapsedLabel = formatTimestamp(elapsed);
    const remainingLabel = formatTimestamp(remaining);
    const durationLabel = formatTimestamp(duration);

    progressElapsedEl.textContent = elapsedLabel;
    updateProgressRightTime(remainingLabel, durationLabel);
    progressSlider.style.setProperty("--ts-progress", `${progress * 100}%`);
    progressSlider.title = `${elapsedLabel} elapsed, ${remainingLabel} remaining`;
  }

  function updateProgressRightTime(remainingLabel, durationLabel) {
    const showingDuration = state.progressTimeMode === PROGRESS_TIME_MODES.DURATION;
    progressRemainingEl.textContent = showingDuration ? durationLabel : `-${remainingLabel}`;
    progressRemainingEl.title = showingDuration ? "Show remaining time" : "Show track duration";
    progressRemainingEl.setAttribute("aria-pressed", String(showingDuration));
    progressRemainingEl.setAttribute("aria-label", showingDuration ? "Showing track duration" : "Showing remaining time");
  }

  function updateUi() {
    const session = state.session;
    if (!isCurrentSession(session)) {
      return;
    }

    ensureUi();
    const video = getVideo();
    const videoId = getCurrentVideoId();
    const tracksAvailable = tracksBelongToVideo(videoId);
    const isPlaying = Boolean(video && !video.paused);
    const isFloating = state.panelMode === PANEL_MODES.FLOATING;
    const isAnchoredCompact = state.panelMode === PANEL_MODES.ANCHORED && state.anchoredCompact;
    const isHiddenByFullscreen = isFullscreenActive() && state.panelMode === PANEL_MODES.ANCHORED;
    const isVisible = tracksAvailable && state.panelOpen && !isHiddenByFullscreen;
    const isInlineCompact = isVisible && isAnchoredCompact;
    syncLauncherForSession(session, tracksAvailable, { restorePlayer: false });
    const mountedInlineCompact = mountPlayerForMode(isInlineCompact);
    root.classList.toggle("is-shuffle-enabled", state.playback.shuffleEnabled);
    root.classList.toggle("is-repeat-enabled", state.playback.repeatMode === REPEAT_MODES.ONE);
    root.classList.toggle("is-playing", isPlaying);
    root.classList.toggle("has-tracks", tracksAvailable);
    root.classList.toggle("is-visible", isVisible);
    root.classList.toggle("is-anchored", state.panelMode === PANEL_MODES.ANCHORED);
    root.classList.toggle("is-anchored-compact", isAnchoredCompact);
    root.classList.toggle("is-inline-compact", mountedInlineCompact);
    root.classList.toggle("is-floating", isFloating);
    previousButton.disabled = !tracksAvailable;
    playPauseButton.disabled = !tracksAvailable;
    playPauseButton.setAttribute("aria-label", isPlaying ? "Pause" : "Play");
    playPauseButton.title = isPlaying ? "Pause" : "Play";
    progressSlider.setAttribute("aria-disabled", String(!tracksAvailable));
    toggleButton.disabled = !tracksAvailable;
    toggleButton.setAttribute("aria-label", state.playback.shuffleEnabled ? "Turn shuffle off" : "Turn shuffle on");
    toggleButton.title = state.playback.shuffleEnabled ? "Shuffle on" : "Shuffle";
    repeatButton.disabled = !tracksAvailable;
    repeatButton.setAttribute("aria-label", state.playback.repeatMode === REPEAT_MODES.ONE ? "Turn repeat off" : "Turn repeat on");
    repeatButton.title = state.playback.repeatMode === REPEAT_MODES.ONE ? "Repeat on" : "Repeat current track";
    nextButton.disabled = !tracksAvailable;
    compactButton.disabled = !tracksAvailable || isFloating;
    compactButton.setAttribute("aria-pressed", String(isAnchoredCompact));
    compactButton.setAttribute("aria-label", isAnchoredCompact ? "Expand player" : "Compact player");
    compactButton.title = isAnchoredCompact ? "Expand player" : "Compact player";
    popoutButton.setAttribute("aria-label", isFloating ? "Dock player" : "Pop out player");
    popoutButton.title = isFloating ? "Dock player" : "Pop out player";

    const track = state.tracks[state.currentTrackIndex];
    const trackLabel = track ? formatTrackLabel(track) : "No track selected";
    trackEl.textContent = trackLabel;
    trackEl.title = track ? trackLabel : "";
    countEl.textContent = track ? `${track.index + 1} / ${state.tracks.length}` : "";
    updateProgress(video);
    renderTrackList();
    if (isVisible) {
      layoutPlayer();
    }
  }

  init();
})();
