(() => {
  const ROOT_ID = "timestamp-player-root";
  const {
    PROGRESS_TIME_MODE_VALUES,
  } = globalThis.TimestampPlayerSettings;
  const REQUIRED_ELEMENTS = Object.freeze({
    dragHandle: ".ts-drag-handle",
    resizeHandle: ".ts-resize-handle",
    compactButton: ".ts-compact-toggle",
    popoutButton: ".ts-popout",
    closeButton: ".ts-close",
    trackEl: ".ts-track",
    countEl: ".ts-count",
    progressElapsedEl: ".ts-progress-elapsed",
    progressRemainingEl: ".ts-progress-remaining",
    progressSlider: ".ts-progress-slider",
    liveStatusEl: ".ts-live-status",
    listEl: ".ts-list",
    previousButton: ".ts-previous",
    playPauseButton: ".ts-play-pause",
    toggleButton: ".ts-toggle",
    repeatButton: ".ts-repeat",
    nextButton: ".ts-next",
  });

  function createPlayerViewController({
    document: documentObject = globalThis.document,
    createTrackListRenderer,
    formatTimestamp,
    formatTrackLabel,
    compactProgressColors = {},
    compactProgressStyles = {},
    trackHighlightColors = {},
    prefersReducedMotion = defaultPrefersReducedMotion,
    handlers = {},
  } = {}) {
    if (!documentObject || typeof createTrackListRenderer !== "function") {
      throw new TypeError("Player view document and track-list renderer are required");
    }
    if (typeof formatTimestamp !== "function" || typeof formatTrackLabel !== "function") {
      throw new TypeError("Player view formatters are required");
    }
    if (typeof prefersReducedMotion !== "function") {
      throw new TypeError("Player view motion preference must be a function");
    }

    let elements = null;
    let lastAnnouncedTrackKey = null;
    let trackListRenderer = null;
    let listenerCleanups = [];

    function ensure() {
      if (elements?.root?.isConnected) {
        return elements;
      }

      if (elements) {
        releaseCurrentShell();
      }

      const root = documentObject.getElementById(ROOT_ID) || createShell();
      elements = lookupElements(root);
      trackListRenderer = createTrackListRenderer({
        document: documentObject,
        formatTimestamp,
        formatTrackLabel,
        listElement: elements.listEl,
      });
      bindStableEvents();
      return elements;
    }

    function createShell() {
      const root = documentObject.createElement("div");
      root.id = ROOT_ID;
      root.hidden = true;
      root.setAttribute("aria-hidden", "true");
      root.setAttribute("aria-label", "Timestamp player");
      root.setAttribute("role", "region");
      root.innerHTML = `
        <span id="timestamp-player-layout-instructions" class="ts-visually-hidden">
          Press Enter or Space to start adjusting. Use arrow keys to move by 10 pixels or Shift plus an arrow for 1 pixel. Press Enter to save, Escape to cancel, or Home to reset.
        </span>
        <button class="ts-drag-handle" type="button" aria-label="Move floating player" aria-describedby="timestamp-player-layout-instructions" aria-keyshortcuts="Enter Space ArrowUp ArrowDown ArrowLeft ArrowRight Home Escape" aria-pressed="false" title="Move floating player"></button>
        <button class="ts-resize-handle" type="button" aria-label="Resize player" aria-describedby="timestamp-player-layout-instructions" aria-keyshortcuts="Enter Space ArrowUp ArrowDown ArrowLeft ArrowRight Home Escape" aria-pressed="false" title="Resize player"></button>
        <button class="ts-compact-toggle" type="button" aria-label="Compact player" aria-pressed="false" title="Compact player">
          <svg class="ts-icon ts-stroke-icon ts-compact-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 9l6 6 6-6"></path>
          </svg>
          <svg class="ts-icon ts-stroke-icon ts-expand-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 15l6-6 6 6"></path>
          </svg>
        </button>
        <button class="ts-popout" type="button" aria-label="Pop out player" aria-pressed="false" title="Pop out player">
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
            <button class="ts-track" type="button" aria-label="No current track" disabled>No track selected</button>
          </div>
          <div class="ts-progress">
            <div class="ts-progress-times">
              <span class="ts-progress-elapsed">0:00</span>
              <button class="ts-progress-remaining" type="button" aria-label="Show track duration" aria-pressed="false" title="Toggle duration and remaining time">-0:00</button>
            </div>
            <input class="ts-progress-slider" type="range" min="0" max="1" step="0.1" value="0" aria-label="Seek within current track">
          </div>
          <div class="ts-controls" role="group" aria-label="Playback controls">
            <button class="ts-icon-button ts-toggle" type="button" aria-label="Shuffle" aria-pressed="false" title="Shuffle">
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
            <button class="ts-icon-button ts-repeat" type="button" aria-label="Repeat current track" aria-pressed="false" title="Repeat current track">
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
          <div class="ts-live-status ts-visually-hidden" aria-live="polite" aria-atomic="true"></div>
        </div>
      `;
      documentObject.documentElement.append(root);
      return root;
    }

    function lookupElements(root) {
      const nextElements = { root };
      for (const [name, selector] of Object.entries(REQUIRED_ELEMENTS)) {
        const element = root.querySelector(selector);
        if (!element) {
          throw new Error(`Player shell is missing ${selector}`);
        }
        nextElements[name] = element;
      }
      return Object.freeze(nextElements);
    }

    function bindStableEvents() {
      addListener(elements.root, "keydown", handlers.onPlayerKeyDown);
      addListener(elements.compactButton, "click", handlers.onCompactToggle);
      addListener(elements.popoutButton, "click", handlers.onPanelModeToggle);
      addListener(elements.closeButton, "click", handlers.onClose);
      addListener(elements.trackEl, "click", handlers.onCurrentTrackClick);
      addListener(elements.previousButton, "click", handlers.onPreviousTrack);
      addListener(elements.playPauseButton, "click", handlers.onPlayPause);
      addListener(elements.toggleButton, "click", handlers.onShuffleToggle);
      addListener(elements.repeatButton, "click", handlers.onRepeatToggle);
      addListener(elements.nextButton, "click", handlers.onNextTrack);
      addListener(elements.progressSlider, "input", handlers.onProgressInput);
      addListener(elements.progressRemainingEl, "click", handlers.onProgressTimeModeToggle);
      addListener(elements.listEl, "click", handlers.onTrackListClick);
    }

    function addListener(target, type, listener) {
      if (typeof listener !== "function") {
        return;
      }
      target.addEventListener(type, listener);
      listenerCleanups.push(() => target.removeEventListener(type, listener));
    }

    function render({
      anchored = false,
      anchoredCompact = false,
      controlsEnabled = false,
      currentTrackIndex = -1,
      floating = false,
      inlineCompact = false,
      playing = false,
      repeatEnabled = false,
      shuffleEnabled = false,
      tracks = [],
      tracksAvailable = false,
      visible = false,
    } = {}) {
      ensure();
      const { root } = elements;
      root.classList.toggle("is-shuffle-enabled", shuffleEnabled);
      root.classList.toggle("is-repeat-enabled", repeatEnabled);
      root.classList.toggle("is-playing", playing);
      root.classList.toggle("has-tracks", tracksAvailable);
      root.classList.toggle("is-visible", visible);
      root.classList.toggle("is-anchored", anchored);
      root.classList.toggle("is-anchored-compact", anchoredCompact);
      root.classList.toggle("is-inline-compact", inlineCompact);
      root.classList.toggle("is-floating", floating);
      root.hidden = !visible;
      root.setAttribute("aria-hidden", String(!visible));

      elements.dragHandle.disabled = !floating;
      elements.resizeHandle.disabled = !visible;
      elements.previousButton.disabled = !controlsEnabled;
      elements.playPauseButton.disabled = !controlsEnabled;
      setLabelAndTitle(elements.playPauseButton, playing ? "Pause" : "Play");
      elements.progressSlider.disabled = !controlsEnabled;
      elements.toggleButton.disabled = !controlsEnabled;
      elements.toggleButton.setAttribute("aria-pressed", String(shuffleEnabled));
      elements.repeatButton.disabled = !controlsEnabled;
      elements.repeatButton.setAttribute("aria-pressed", String(repeatEnabled));
      elements.nextButton.disabled = !controlsEnabled;
      elements.compactButton.disabled = !tracksAvailable || floating;
      elements.compactButton.setAttribute("aria-pressed", String(anchoredCompact));
      elements.compactButton.title = anchoredCompact ? "Expand player" : "Compact player";
      elements.popoutButton.setAttribute("aria-pressed", String(floating));
      elements.popoutButton.title = floating ? "Dock player" : "Pop out player";

      const track = tracks[currentTrackIndex];
      const trackLabel = track ? formatTrackLabel(track) : "No track selected";
      elements.trackEl.textContent = trackLabel;
      elements.trackEl.title = track ? trackLabel : "";
      elements.trackEl.disabled = !track || anchoredCompact;
      elements.trackEl.setAttribute(
        "aria-label",
        track ? `Show current track in list: ${trackLabel}` : "No current track"
      );
      elements.countEl.textContent = track ? `${track.index + 1} / ${tracks.length}` : "";
      renderTrackList(tracks, currentTrackIndex, controlsEnabled);
      renderTrackAnnouncement(track, tracks, visible);
      return elements;
    }

    function setLabelAndTitle(element, value) {
      element.setAttribute("aria-label", value);
      element.title = value;
    }

    function renderProgress({
      active = false,
      duration = 0,
      elapsed = 0,
      timeMode = PROGRESS_TIME_MODE_VALUES.REMAINING,
    } = {}) {
      ensure();
      if (!active) {
        elements.progressElapsedEl.textContent = "0:00";
        renderProgressRightTime("0:00", "0:00", timeMode);
        elements.progressSlider.style.setProperty("--ts-progress", "0%");
        elements.progressSlider.max = "1";
        elements.progressSlider.value = "0";
        elements.progressSlider.removeAttribute("aria-valuetext");
        elements.progressSlider.removeAttribute("title");
        return;
      }

      const safeDuration = Math.max(0, duration);
      const safeElapsed = clamp(elapsed, 0, safeDuration);
      const remaining = Math.max(0, safeDuration - safeElapsed);
      const progress = safeDuration > 0 ? safeElapsed / safeDuration : 0;
      const elapsedLabel = formatTimestamp(safeElapsed);
      const remainingLabel = formatTimestamp(remaining);
      const durationLabel = formatTimestamp(safeDuration);

      elements.progressElapsedEl.textContent = elapsedLabel;
      renderProgressRightTime(remainingLabel, durationLabel, timeMode);
      elements.progressSlider.style.setProperty("--ts-progress", `${progress * 100}%`);
      elements.progressSlider.max = String(safeDuration || 1);
      elements.progressSlider.value = String(safeElapsed);
      elements.progressSlider.setAttribute(
        "aria-valuetext",
        `${elapsedLabel} elapsed of ${durationLabel}`
      );
      elements.progressSlider.title = `${elapsedLabel} elapsed, ${remainingLabel} remaining`;
    }

    function renderProgressRightTime(remainingLabel, durationLabel, timeMode) {
      const showingDuration = timeMode === PROGRESS_TIME_MODE_VALUES.DURATION;
      elements.progressRemainingEl.textContent = showingDuration ? durationLabel : `-${remainingLabel}`;
      elements.progressRemainingEl.setAttribute("aria-pressed", String(showingDuration));
    }

    function renderTrackAnnouncement(track, tracks, visible) {
      const trackKey = track ? `${track.index}\u0000${track.start}` : null;
      if (!visible) {
        lastAnnouncedTrackKey = trackKey;
        elements.liveStatusEl.textContent = "";
        return false;
      }
      if (trackKey === lastAnnouncedTrackKey) {
        return false;
      }

      lastAnnouncedTrackKey = trackKey;
      if (!track) {
        elements.liveStatusEl.textContent = "";
        return true;
      }
      elements.liveStatusEl.textContent =
        `Track ${track.index + 1} of ${tracks.length}: ${formatTrackLabel(track)}`;
      return true;
    }

    function renderTrackList(tracks = [], currentTrackIndex = -1, enabled = true) {
      ensure();
      const enabledChanged = trackListRenderer.renderEnabled(enabled);
      const collectionChanged = trackListRenderer.renderCollection(tracks);
      const activeChanged = trackListRenderer.renderActive(currentTrackIndex);
      return { activeChanged, collectionChanged, enabledChanged };
    }

    function applySettings(settings = {}) {
      if (!elements?.root) {
        return false;
      }

      const compactProgressStyle = compactProgressStyles[settings.compactProgressStyle]
        || compactProgressStyles.subtle;
      const compactProgressColor = resolveProgressColor(
        settings.compactProgressColor,
        settings.compactProgressCustomColor
      );
      const progressColor = resolveProgressColor(
        settings.progressColor,
        settings.progressCustomColor
      );
      const highlightColor = trackHighlightColors[settings.trackHighlightColor]
        || trackHighlightColors.purple;

      elements.root.style.setProperty("--ts-compact-progress-height", compactProgressStyle.height);
      elements.root.style.setProperty("--ts-compact-progress-opacity", compactProgressStyle.opacity);
      elements.root.style.setProperty("--ts-compact-progress-color", compactProgressColor);
      elements.root.style.setProperty("--ts-progress-color", progressColor);
      elements.root.style.setProperty("--ts-active-track-bg", highlightColor.bg);
      elements.root.style.setProperty("--ts-active-track-hover-bg", highlightColor.hoverBg);
      elements.root.style.setProperty("--ts-active-track-text", highlightColor.text);
      return true;
    }

    function resolveProgressColor(colorName, customColor) {
      const colorChoice = compactProgressColors[colorName] || compactProgressColors.red;
      return colorName === "custom" ? customColor : colorChoice.color;
    }

    function getTrackRowForIndex(index) {
      return trackListRenderer?.getRowForIndex(index) || null;
    }

    function getElements() {
      return elements;
    }

    function focusOpenControl({ floating = false } = {}) {
      if (!elements?.root || elements.root.hidden) {
        return false;
      }
      const target = floating ? elements.popoutButton : elements.compactButton;
      if (!target || target.disabled || typeof target.focus !== "function") {
        return false;
      }
      target.focus({ preventScroll: true });
      return true;
    }

    function scrollTrackIntoView(index) {
      const listElement = elements?.listEl;
      const item = getTrackRowForIndex(index);
      if (
        !listElement
        || !item
        || typeof listElement.getBoundingClientRect !== "function"
        || typeof item.getBoundingClientRect !== "function"
      ) {
        return false;
      }

      const listRect = listElement.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();
      const top = Math.max(0, listElement.scrollTop + itemRect.top - listRect.top);
      const behavior = safelyPrefersReducedMotion(prefersReducedMotion) ? "auto" : "smooth";
      if (typeof listElement.scrollTo === "function") {
        listElement.scrollTo({ behavior, top });
      } else {
        listElement.scrollTop = top;
      }
      return true;
    }

    function releaseCurrentShell() {
      listenerCleanups.forEach((cleanup) => cleanup());
      listenerCleanups = [];
      trackListRenderer?.clear();
      trackListRenderer = null;
      lastAnnouncedTrackKey = null;
      elements?.root?.remove();
      elements = null;
    }

    function teardown() {
      releaseCurrentShell();
    }

    return {
      applySettings,
      ensure,
      focusOpenControl,
      getElements,
      getTrackRowForIndex,
      render,
      renderProgress,
      renderTrackList,
      scrollTrackIntoView,
      teardown,
    };
  }

  function defaultPrefersReducedMotion() {
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  }

  function safelyPrefersReducedMotion(preference) {
    try {
      return preference() === true;
    } catch (_error) {
      return false;
    }
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  globalThis.TimestampPlayerPlayerView = {
    ROOT_ID,
    createPlayerViewController,
  };
})();
