(() => {
  const ROOT_ID = "timestamp-player-root";
  const LAUNCHER_ID = "timestamp-player-launcher";
  const COMPACT_HOST_ID = "timestamp-player-compact-host";
  const SCAN_DELAY_MS = 600;
  const DESCRIPTION_EXPAND_FALLBACK_DELAY_MS = 2500;
  const TRACKLIST_ANCHOR_SECONDS = 120;
  const COMMENT_MIN_TRACKS = 3;
  const REGULAR_COMMENT_SCAN_LIMIT = 30;
  const DRAG_VIEWPORT_PADDING = 8;
  const PLAYER_MIN_WIDTH = 260;
  const PLAYER_MIN_HEIGHT = 128;
  const PLAYER_MIN_VISIBLE_WIDTH = 180;
  const PLAYER_MIN_VISIBLE_HEIGHT = 100;
  const COMPACT_PLAYER_MIN_WIDTH = 300;
  const TRACK_END_GRACE_SECONDS = 0.35;
  const PREVIOUS_RESTART_SECONDS = 3;
  const MAX_HISTORY_LENGTH = 100;
  const REPEAT_MODES = {
    OFF: "off",
    ALL: "all",
    ONE: "one",
  };
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
    compareCommentTrackSources,
    parseCommentLikeCount,
  } = globalThis.TimestampPlayerCommentScoring;

  const state = {
    shuffleEnabled: false,
    repeatMode: REPEAT_MODES.OFF,
    progressTimeMode: PROGRESS_TIME_MODES.DURATION,
    panelOpen: false,
    panelMode: PANEL_MODES.ANCHORED,
    anchoredCompact: false,
    tracks: [],
    currentTrackIndex: -1,
    history: [],
    upcoming: [],
    currentVideoId: null,
    descriptionExpandedVideoId: null,
    descriptionFallbackVideoId: null,
    descriptionFallbackReadyAt: 0,
    shouldCollapseDescriptionVideoId: null,
    trackCache: new Map(),
    scanTimer: null,
    playerPosition: null,
    playerSize: null,
    anchoredWidth: null,
    anchoredHeight: null,
    compactWidth: null,
    playerLayoutFrame: null,
    lastUrl: location.href,
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

  function init() {
    ensureUi();
    scanPage();
    document.addEventListener("yt-navigate-finish", handleNavigation);
    window.addEventListener("yt-navigate-finish", handleNavigation);
    new MutationObserver(handlePageMutations).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    setInterval(() => {
      if (state.lastUrl !== location.href) {
        state.lastUrl = location.href;
        handleNavigation();
      }
    }, 1000);
    document.addEventListener("timeupdate", handleTimeUpdate, true);
    document.addEventListener("play", handlePlaybackStateChange, true);
    document.addEventListener("pause", handlePlaybackStateChange, true);
    window.addEventListener("resize", schedulePlayerLayout);
    window.visualViewport?.addEventListener("resize", schedulePlayerLayout);
  }

  function handleNavigation() {
    state.shuffleEnabled = false;
    state.repeatMode = REPEAT_MODES.OFF;
    state.panelOpen = false;
    state.panelMode = PANEL_MODES.ANCHORED;
    state.anchoredCompact = false;
    state.tracks = [];
    state.currentVideoId = getCurrentVideoId();
    state.currentTrackIndex = -1;
    resetPlaybackOrder();
    state.descriptionExpandedVideoId = null;
    state.descriptionFallbackVideoId = null;
    state.descriptionFallbackReadyAt = 0;
    state.shouldCollapseDescriptionVideoId = null;
    scheduleScan();
    updateUi();
  }

  function handlePageMutations(mutations) {
    const onlyExtensionMutations = mutations.every((mutation) => {
      return root?.contains(mutation.target)
        || launcherButton?.contains(mutation.target)
        || compactHost?.contains(mutation.target);
    });
    if (onlyExtensionMutations) {
      return;
    }

    scheduleScan();
  }

  function scheduleScan() {
    if (state.scanTimer) {
      return;
    }

    state.scanTimer = setTimeout(() => {
      state.scanTimer = null;
      scanPage();
    }, SCAN_DELAY_MS);
  }

  function scanPage() {
    const video = getVideo();
    const videoId = getCurrentVideoId();

    if (!video || !videoId) {
      state.tracks = [];
      state.currentVideoId = null;
      updateUi("Open a YouTube video");
      return;
    }

    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      scheduleScan();
      updateUi();
      return;
    }

    prepareDescriptionFallback(videoId);

    const quietDescriptionReadable = canReadQuietDescription();
    const candidates = getTimestampCandidates(videoId);
    let tracks = getTracksForVideo(videoId, video.duration, candidates);
    if (tracks.length < 2 && candidates.length < 2 && !quietDescriptionReadable && shouldWaitForQuietDescriptionScan()) {
      scheduleScan();
      updateUi();
      return;
    }

    if (tracks.length < 2 && candidates.length < 2 && !quietDescriptionReadable && expandDescriptionIfAvailable(videoId)) {
      updateUi("Reading description...");
      return;
    }

    if (tracks.length < 2) {
      tracks = getCommentTracksForVideo(videoId, video.duration);
    }

    if (tracksChanged(state.tracks, tracks)) {
      resetPlaybackOrder();
    }
    state.currentVideoId = videoId;
    state.tracks = tracks;
    state.currentTrackIndex = getTrackAtTime(video.currentTime)?.index ?? -1;
    collapseDescriptionIfNeeded(videoId);
    updateUi();
  }

  function resetPlaybackOrder() {
    state.history = [];
    state.upcoming = [];
  }

  function tracksChanged(previousTracks, nextTracks) {
    if (previousTracks.length !== nextTracks.length) {
      return true;
    }

    return previousTracks.some((track, index) => track.start !== nextTracks[index]?.start);
  }

  function getTracksForVideo(videoId, duration, candidates = getTimestampCandidates(videoId)) {
    const tracks = findTracks(videoId, duration, candidates);
    const cachedTracks = state.trackCache.get(videoId);

    if (tracks.length >= 2) {
      const mergedTracks = mergeCachedTrackTitles(tracks, cachedTracks);
      const bestTracks = chooseBetterTrackSet(mergedTracks, cachedTracks);
      state.trackCache.set(videoId, bestTracks);
      return bestTracks;
    }

    return cachedTracks || [];
  }

  function mergeCachedTrackTitles(tracks, cachedTracks) {
    if (!cachedTracks || tracks.length !== cachedTracks.length) {
      return tracks;
    }

    return tracks.map((track, index) => {
      const cachedTrack = cachedTracks[index];
      if (cachedTrack && cachedTrack.start === track.start && !track.title && cachedTrack.title) {
        return { ...track, title: cachedTrack.title };
      }
      return track;
    });
  }

  function chooseBetterTrackSet(tracks, cachedTracks) {
    if (!cachedTracks) {
      return tracks;
    }

    return trackTitleScore(tracks) >= trackTitleScore(cachedTracks) ? tracks : cachedTracks;
  }

  function trackTitleScore(tracks) {
    return tracks.reduce((score, track) => {
      const title = (track.title || "").trim();
      return score + (title ? 1 : 0);
    }, 0);
  }

  function getVideo() {
    return document.querySelector("video.html5-main-video") || document.querySelector("video");
  }

  function getCurrentVideoId() {
    return new URL(location.href).searchParams.get("v");
  }

  function prepareDescriptionFallback(videoId) {
    if (state.descriptionFallbackVideoId === videoId) {
      return;
    }

    state.descriptionFallbackVideoId = videoId;
    state.descriptionFallbackReadyAt = Date.now() + DESCRIPTION_EXPAND_FALLBACK_DELAY_MS;
  }

  function shouldWaitForQuietDescriptionScan() {
    return Date.now() < state.descriptionFallbackReadyAt;
  }

  function expandDescriptionIfAvailable(videoId) {
    if (state.descriptionExpandedVideoId === videoId) {
      return false;
    }

    const expandButton = findDescriptionExpandButton();
    if (!expandButton) {
      return false;
    }

    state.descriptionExpandedVideoId = videoId;
    state.shouldCollapseDescriptionVideoId = videoId;
    expandButton.click();
    scheduleScan();
    return true;
  }

  function collapseDescriptionIfNeeded(videoId) {
    if (state.shouldCollapseDescriptionVideoId !== videoId) {
      return;
    }

    const collapseButton = findDescriptionCollapseButton();
    if (!collapseButton) {
      return;
    }

    state.shouldCollapseDescriptionVideoId = null;
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
      return;
    }

    ensureLauncherButton();
    const actionRow = findActionRow();
    if (!actionRow) {
      return;
    }

    if (!actionRow.contains(launcherButton)) {
      insertLauncherButton(actionRow);
    }

    launcherButton.classList.toggle("is-active", state.panelOpen);
    launcherButton.setAttribute("aria-pressed", String(state.panelOpen));
    launcherButton.setAttribute("aria-label", state.panelOpen ? "Hide tracklist" : "Open tracklist");
    launcherButton.title = state.panelOpen ? "Hide tracklist" : "Show tracklist";
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

  function findTracks(videoId, duration, candidates = getTimestampCandidates(videoId), minTrackCount = 2) {
    if (candidates.length < minTrackCount || !Number.isFinite(duration) || duration <= 0) {
      return [];
    }

    const bestRun = pickBestIncreasingCandidateRun(getFirstCandidatePerLine(candidates));
    if (bestRun.length < minTrackCount) {
      return [];
    }

    return bestRun.map((candidate, index) => {
      const next = bestRun[index + 1];
      return {
        index,
        start: candidate.start,
        end: next ? Math.max(candidate.start, next.start - 0.2) : duration,
        title: candidate.title,
      };
    });
  }

  function getFirstCandidatePerLine(candidates) {
    const deduped = [];
    const seenLines = new Set();
    const seenStarts = new Set();
    for (const [sourceOrder, candidate] of candidates.entries()) {
      const lineKey = candidate.lineKey || `${sourceOrder}:${candidate.timestampText}`;
      if (seenLines.has(lineKey) || seenStarts.has(candidate.start)) {
        continue;
      }

      seenLines.add(lineKey);
      seenStarts.add(candidate.start);
      deduped.push({ ...candidate, sourceOrder });
    }

    return deduped;
  }

  function pickBestIncreasingCandidateRun(candidates) {
    const runs = [];
    let currentRun = [];

    for (const candidate of candidates) {
      const previous = currentRun[currentRun.length - 1];
      if (!previous || candidate.start > previous.start) {
        currentRun.push(candidate);
      } else {
        runs.push(currentRun);
        currentRun = [candidate];
      }
    }

    runs.push(currentRun);

    const viableRuns = runs.filter((run) => run.length >= 2);
    const anchoredRuns = viableRuns.filter((run) => run[0].start <= TRACKLIST_ANCHOR_SECONDS);
    if (anchoredRuns.length) {
      return anchoredRuns.sort(compareCandidateRuns)[0];
    }

    if (viableRuns.length === 1 && viableRuns[0].length === candidates.length) {
      return viableRuns[0];
    }

    return [];
  }

  function compareCandidateRuns(left, right) {
    if (left.length !== right.length) {
      return right.length - left.length;
    }

    if (left[0].start !== right[0].start) {
      return left[0].start - right[0].start;
    }

    return left[0].sourceOrder - right[0].sourceOrder;
  }

  function getTimestampCandidates(videoId) {
    const roots = getTimestampCandidateRoots();

    const links = [];
    for (const searchRoot of roots) {
      for (const link of searchRoot.querySelectorAll("a[href*='/watch']")) {
        if (!links.includes(link)) {
          links.push(link);
        }
      }
    }

    return links
      .map((link) => toTimestampCandidate(link, videoId))
      .filter(Boolean);
  }

  function getTimestampCandidateRoots() {
    const selectors = [
      ...getQuietDescriptionSelectors(),
      "ytd-watch-metadata #description-inline-expander #expanded",
      "ytd-watch-metadata #description-inline-expander",
      "ytd-watch-metadata #description",
      "ytd-watch-metadata",
    ];

    return getUniqueElements(selectors);
  }

  function getCommentTracksForVideo(videoId, duration) {
    const bestSource = getBestCommentTrackSource(videoId, duration);
    if (!bestSource) {
      return [];
    }

    const cachedTracks = state.trackCache.get(videoId);
    const mergedTracks = mergeCachedTrackTitles(bestSource.tracks, cachedTracks);
    const bestTracks = chooseBetterTrackSet(mergedTracks, cachedTracks);
    state.trackCache.set(videoId, bestTracks);
    return bestTracks;
  }

  function getBestCommentTrackSource(videoId, duration) {
    const validSources = getCommentTimestampSources().map((source) => {
      return {
        ...source,
        duration,
        tracks: findTracks(videoId, duration, source.candidates, COMMENT_MIN_TRACKS),
      };
    }).filter((source) => source.tracks.length >= COMMENT_MIN_TRACKS);

    return validSources.sort(compareCommentTrackSources)[0] || null;
  }

  function getCommentTimestampSources() {
    const sources = [];
    let regularCommentCount = 0;

    for (const [order, root] of getCommentRoots().entries()) {
      const sourceType = getCommentSourceType(root);
      if (sourceType === COMMENT_SOURCE_TYPES.REGULAR) {
        regularCommentCount += 1;
        if (regularCommentCount > REGULAR_COMMENT_SCAN_LIMIT) {
          continue;
        }
      }

      const candidates = getTextTimestampCandidates(getCommentBodyText(root), `comment:${order}`);
      if (candidates.length >= COMMENT_MIN_TRACKS) {
        sources.push({
          sourceType,
          order,
          likeCount: getCommentLikeCount(root),
          candidates,
        });
      }
    }

    return sources;
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

  function getTextTimestampCandidates(text, sourceKey) {
    const candidates = [];
    const lines = (text || "").split(/\r?\n/);
    for (const [lineIndex, line] of lines.entries()) {
      for (const match of line.matchAll(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g)) {
        const timestampText = match[0];
        const start = parseTimestampText(timestampText);
        if (!Number.isFinite(start)) {
          continue;
        }

        candidates.push({
          start,
          timestampText,
          title: cleanTrackTitle(titleFromLineFragment(line, timestampText)),
          lineKey: `${sourceKey}:${lineIndex}:${normalizeTitleText(line)}`,
        });
      }
    }

    return candidates;
  }

  function canReadQuietDescription() {
    return getUniqueElements(getQuietDescriptionSelectors()).some((root) => {
      return normalizeTitleText(root.textContent).length > 0;
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

    return {
      start,
      timestampText: link.textContent.trim(),
      title: cleanTrackTitle(extractTrackTitle(link)),
      lineKey: normalizeTitleText(getTimestampLineText(link)),
    };
  }

  function parseTimeParam(value) {
    if (!value) {
      return NaN;
    }

    const compact = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s?)?$/);
    if (compact) {
      const hours = parseFloat(compact[1] || "0");
      const minutes = parseFloat(compact[2] || "0");
      const seconds = parseFloat(compact[3] || "0");
      return hours * 3600 + minutes * 60 + seconds;
    }

    const seconds = parseFloat(value);
    return Number.isFinite(seconds) ? seconds : NaN;
  }

  function parseTimestampText(value) {
    const text = (value || "").trim();
    if (!/^\d{1,2}:\d{2}(?::\d{2})?$/.test(text)) {
      return NaN;
    }

    const parts = text.split(":").map((part) => parseInt(part, 10));
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  function extractTrackTitle(link) {
    const timestamp = link.textContent.trim();
    const lineTitle = titleFromLineFragment(getTimestampLineText(link), timestamp);
    if (lineTitle) {
      return lineTitle;
    }

    const inlineText = collectTextAfterTimestampLink(link);
    return titleFromLineFragment(inlineText, timestamp);
  }

  function getTimestampLineText(link) {
    const host = link.closest(".ytAttributedStringHost, yt-attributed-string, #description, div, li, p");
    const text = host?.innerText || host?.textContent || "";
    return lineContainingTimestamp(text, link.textContent.trim());
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

  function lineContainingTimestamp(text, timestamp) {
    const lines = text.split(/\r?\n/);
    return lines.find((entry) => entry.includes(timestamp)) || "";
  }

  function titleFromLineFragment(line, timestamp) {
    const normalizedLine = normalizeTitleText(line);
    const timestampIndex = normalizedLine.indexOf(timestamp);
    if (timestampIndex === -1) {
      return "";
    }

    const beforeTimestamp = normalizedLine.slice(0, timestampIndex);
    const afterTimestamp = normalizedLine.slice(timestampIndex + timestamp.length);
    const beforeTitle = stripTimestampAdjacency(beforeTimestamp, "before");
    const afterTitle = stripTimestampAdjacency(afterTimestamp, "after");

    if (beforeTitle && afterTitle) {
      return beforeTitle.length >= afterTitle.length ? beforeTitle : afterTitle;
    }

    return beforeTitle || trimAfterEmbeddedTimestamp(afterTitle);
  }

  function stripTimestampAdjacency(text, side) {
    let cleaned = normalizeTitleText(text);

    if (side === "before") {
      cleaned = cleaned
        .replace(/[\s([{\-–—:|/]*$/g, "")
        .replace(/\s+\d{1,2}:\d{2}(?::\d{2})?.*$/g, "");
    } else {
      cleaned = cleaned.replace(/^[\s)\]}.,;:\-–—|/]+/g, "");
    }

    return cleaned.trim();
  }

  function cleanTrackTitle(title) {
    const cleaned = normalizeTitleText(title)
      .replace(/\s+\/\s*(?:original|vocal|lyrics|arrange|arrangement|source)\b.*$/i, "")
      .replace(/^\s*(?:track\s*)?\d{1,3}[\s.)\]-]+/i, "")
      .trim();

    return isTimestampOnlyText(cleaned) ? "" : cleaned;
  }

  function isTimestampOnlyText(text) {
    if (!text) {
      return false;
    }

    return text
      .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, "")
      .replace(/[\s()[\]{}.,;:\-–—|/]+/g, "")
      .trim() === "";
  }

  function normalizeTitleText(text) {
    return (text || "")
      .replace(/\u00a0/g, " ")
      .replace(/\u3000/g, " ")
      .replace(/[ \t]+/g, " ")
      .trim();
  }

  function trimAfterEmbeddedTimestamp(text) {
    return normalizeTitleText(text)
      .replace(/\s+\d{1,2}:\d{2}(?::\d{2})?.*$/, "")
      .trim();
  }

  function formatTrackLabel(track) {
    return track.title || `Track ${track.index + 1}`;
  }

  function formatTimestamp(seconds) {
    const totalSeconds = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const remainingSeconds = totalSeconds % 60;
    const paddedSeconds = String(remainingSeconds).padStart(2, "0");

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
    }

    return `${minutes}:${paddedSeconds}`;
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
    updateUi();
  }

  function togglePlayerOpen() {
    if (state.panelOpen) {
      closePlayer();
      return;
    }

    state.panelOpen = true;
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

    resizeHandle.releasePointerCapture?.(event.pointerId);
    resizePointerId = null;
    resizeMode = null;
    root.classList.remove("is-resizing");
    resizeHandle.removeEventListener("pointermove", handleResizePointerMove);
    resizeHandle.removeEventListener("pointerup", handleResizePointerEnd);
    resizeHandle.removeEventListener("pointercancel", handleResizePointerEnd);
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
    state.shuffleEnabled = !state.shuffleEnabled;
    if (state.shuffleEnabled && state.tracks.length < 2) {
      state.shuffleEnabled = false;
    }
    if (state.shuffleEnabled) {
      resetPlaybackOrder();
    } else {
      state.upcoming = [];
    }
    updateUi();
  }

  function toggleRepeat() {
    state.repeatMode = state.repeatMode === REPEAT_MODES.ONE ? REPEAT_MODES.OFF : REPEAT_MODES.ONE;
    if (state.repeatMode !== REPEAT_MODES.OFF && state.tracks.length < 2) {
      state.repeatMode = REPEAT_MODES.OFF;
    }
    updateUi();
  }

  function toggleProgressTimeMode(event) {
    event.preventDefault();
    state.progressTimeMode =
      state.progressTimeMode === PROGRESS_TIME_MODES.REMAINING
        ? PROGRESS_TIME_MODES.DURATION
        : PROGRESS_TIME_MODES.REMAINING;
    updateProgress();
  }

  function playNextTrack(options = {}) {
    const nextIndex = state.shuffleEnabled ? pickNextShuffleTrackIndex(options.currentIndex) : pickSequentialTrackIndex();
    playTrack(nextIndex, { previousIndex: options.previousIndex });
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

    const previousIndex = pickPreviousTrackIndex(currentIndex);
    if (state.shuffleEnabled && previousIndex !== currentIndex) {
      queueTrackNext(currentIndex);
    }
    playTrack(previousIndex, { recordHistory: false });
  }

  function pickPreviousTrackIndex(currentIndex) {
    if (!state.shuffleEnabled) {
      return pickPreviousSequentialTrackIndex(currentIndex);
    }

    return state.history.length ? state.history.pop() : currentIndex;
  }

  function playTrack(index, options = {}) {
    const { recordHistory = true } = options;
    const video = getVideo();
    const track = state.tracks[index];
    if (!video || !track) {
      updateUi();
      return;
    }

    const previousIndex = options.previousIndex ?? getCurrentTrackIndexForVideo(video);
    if (recordHistory) {
      pushHistory(previousIndex, index);
    }
    removeUpcomingTrack(index);
    state.currentTrackIndex = index;
    video.currentTime = track.start;
    video.play().catch(() => {});
    updateUi();
  }

  function pushHistory(previousIndex, nextIndex) {
    if (!isValidTrackIndex(previousIndex) || previousIndex === nextIndex) {
      return;
    }

    state.history.push(previousIndex);
    if (state.history.length > MAX_HISTORY_LENGTH) {
      state.history.shift();
    }
  }

  function pickNextShuffleTrackIndex(currentIndex = getEffectiveCurrentTrackIndex()) {
    while (state.upcoming.length && (!isValidTrackIndex(state.upcoming[0]) || state.upcoming[0] === currentIndex)) {
      state.upcoming.shift();
    }

    if (!state.upcoming.length) {
      refillShuffleQueue(currentIndex);
    }

    return state.upcoming.shift() ?? pickSequentialTrackIndex();
  }

  function pickSequentialTrackIndex() {
    if (!state.tracks.length) {
      return -1;
    }

    const currentIndex = getEffectiveCurrentTrackIndex();
    if (currentIndex < 0) {
      return 0;
    }

    return (currentIndex + 1) % state.tracks.length;
  }

  function pickPreviousSequentialTrackIndex(currentIndex) {
    if (!state.tracks.length) {
      return -1;
    }

    if (currentIndex <= 0) {
      return state.repeatMode === REPEAT_MODES.ALL ? state.tracks.length - 1 : 0;
    }

    return currentIndex - 1;
  }

  function refillShuffleQueue(excludeIndex) {
    const indices = state.tracks
      .map((track, index) => index)
      .filter((index) => index !== excludeIndex);

    state.upcoming = shuffleIndices(indices);
  }

  function shuffleIndices(indices) {
    const shuffled = [...indices];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
  }

  function queueTrackNext(index) {
    if (!isValidTrackIndex(index)) {
      return;
    }

    removeUpcomingTrack(index);
    state.upcoming.unshift(index);
  }

  function removeUpcomingTrack(index) {
    state.upcoming = state.upcoming.filter((trackIndex) => trackIndex !== index);
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

    const video = event.target;
    const currentTrack = getCurrentTrack(video.currentTime);
    if (currentTrack && currentTrack.index !== state.currentTrackIndex) {
      state.currentTrackIndex = currentTrack.index;
      updateUi();
      return;
    }

    const activeTrack = state.tracks[state.currentTrackIndex];
    if (activeTrack && video.currentTime >= activeTrack.end - TRACK_END_GRACE_SECONDS) {
      if (state.repeatMode === REPEAT_MODES.ONE) {
        playTrack(activeTrack.index, { recordHistory: false });
        return;
      } else if (state.shuffleEnabled) {
        playNextTrack({
          currentIndex: activeTrack.index,
          previousIndex: activeTrack.index,
        });
        return;
      } else if (state.repeatMode === REPEAT_MODES.ALL && activeTrack.index === state.tracks.length - 1) {
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

  function getCurrentTrack(time) {
    return getTrackAtTime(time);
  }

  function getTrackAtTime(time) {
    return state.tracks.find((track) => time >= track.start && time < track.end) || null;
  }

  function getProgressTrack(video) {
    if (!video) {
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
    listEl.replaceChildren();

    for (const track of state.tracks) {
      const trackLabel = formatTrackLabel(track);
      const item = document.createElement("button");
      item.type = "button";
      item.className = "ts-list-item";
      item.dataset.index = String(track.index);
      item.title = trackLabel;
      item.classList.toggle("is-active", track.index === state.currentTrackIndex);

      const number = document.createElement("span");
      number.className = "ts-list-number";
      number.textContent = String(track.index + 1);

      const title = document.createElement("span");
      title.className = "ts-list-title";
      title.textContent = trackLabel;
      title.title = trackLabel;

      const time = document.createElement("span");
      time.className = "ts-list-time";
      time.textContent = formatTimestamp(track.start);

      item.append(number, title, time);
      listEl.append(item);
    }
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
    ensureUi();
    const video = getVideo();
    const tracksAvailable = state.tracks.length >= 2;
    const isPlaying = Boolean(video && !video.paused);
    const isFloating = state.panelMode === PANEL_MODES.FLOATING;
    const isAnchoredCompact = state.panelMode === PANEL_MODES.ANCHORED && state.anchoredCompact;
    const isVisible = tracksAvailable && state.panelOpen;
    const isInlineCompact = isVisible && isAnchoredCompact;
    syncLauncher(tracksAvailable);
    const mountedInlineCompact = mountPlayerForMode(isInlineCompact);
    root.classList.toggle("is-shuffle-enabled", state.shuffleEnabled);
    root.classList.toggle("is-repeat-enabled", state.repeatMode === REPEAT_MODES.ONE);
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
    toggleButton.setAttribute("aria-label", state.shuffleEnabled ? "Turn shuffle off" : "Turn shuffle on");
    toggleButton.title = state.shuffleEnabled ? "Shuffle on" : "Shuffle";
    repeatButton.disabled = !tracksAvailable;
    repeatButton.setAttribute("aria-label", state.repeatMode === REPEAT_MODES.ONE ? "Turn repeat off" : "Turn repeat on");
    repeatButton.title = state.repeatMode === REPEAT_MODES.ONE ? "Repeat on" : "Repeat current track";
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
