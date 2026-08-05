(() => {
  const COMPACT_HOST_ID = "timestamp-player-compact-host";
  const DRAG_VIEWPORT_PADDING = 8;
  const PLAYER_MIN_WIDTH = 260;
  const PLAYER_MIN_HEIGHT = 128;
  const PLAYER_MIN_VISIBLE_WIDTH = 180;
  const PLAYER_MIN_VISIBLE_HEIGHT = 100;
  const COMPACT_PLAYER_MIN_WIDTH = 300;
  const COMPACT_FIT_TEXT_PADDING = 2;
  const COMPACT_TITLE_GAP = 12;
  const COMPACT_TITLE_LINE_TOLERANCE = 1;
  const COMPACT_ANCHOR_GAP = 6;
  const KEYBOARD_LAYOUT_STEP = 10;
  const KEYBOARD_LAYOUT_FINE_STEP = 1;
  const PANEL_MODES = Object.freeze({
    ANCHORED: "anchored",
    FLOATING: "floating",
  });
  const RESIZE_MODES = Object.freeze({
    FLOATING: "floating",
    ANCHORED: "anchored",
    COMPACT_WIDTH: "compact-width",
  });

  function createPlayerLayoutController({
    document: documentObject = globalThis.document,
    window: windowObject = globalThis.window,
    saveSettings = () => {},
    getLauncherElement = () => null,
    findActionRow = () => null,
    findCompactActionAnchor = () => null,
    getVideoTitleLineRects = () => [],
    requestFrame = windowObject?.requestAnimationFrame?.bind(windowObject),
    cancelFrame = windowObject?.cancelAnimationFrame?.bind(windowObject),
  } = {}) {
    let root = null;
    let dragHandle = null;
    let resizeHandle = null;
    let trackElement = null;
    let compactHost = null;
    let connected = false;
    let keyboardInteraction = null;

    let playerPosition = null;
    let playerSize = null;
    let anchoredWidth = null;
    let anchoredHeight = null;
    let compactWidth = null;
    let effectiveCompactWidth = null;
    let avoidVideoTitleOverlap = true;
    let compactManualOverride = false;
    let compactVideoSessionKey = null;
    let playerLayoutFrame = null;

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
    let compactResizeChanged = false;
    let view = {
      visible: false,
      panelMode: PANEL_MODES.ANCHORED,
      anchoredCompact: false,
      inlineCompact: false,
    };

    function connect(elements = {}) {
      const nextRoot = elements.root || null;
      const nextDragHandle = elements.dragHandle || null;
      const nextResizeHandle = elements.resizeHandle || null;
      const nextTrackElement = elements.trackElement || null;
      if (
        connected
        && root === nextRoot
        && dragHandle === nextDragHandle
        && resizeHandle === nextResizeHandle
        && trackElement === nextTrackElement
      ) {
        return controller;
      }

      if (connected || root || dragHandle || resizeHandle || trackElement) {
        disconnect();
      }

      root = nextRoot;
      dragHandle = nextDragHandle;
      resizeHandle = nextResizeHandle;
      trackElement = nextTrackElement;
      dragHandle?.addEventListener?.("pointerdown", handleDragPointerDown);
      dragHandle?.addEventListener?.("keydown", handleDragKeyDown);
      dragHandle?.addEventListener?.("blur", handleDragBlur);
      resizeHandle?.addEventListener?.("pointerdown", handleResizePointerDown);
      resizeHandle?.addEventListener?.("dblclick", handleResizeDoubleClick);
      resizeHandle?.addEventListener?.("keydown", handleResizeKeyDown);
      resizeHandle?.addEventListener?.("blur", handleResizeBlur);
      windowObject?.addEventListener?.("resize", schedule);
      windowObject?.addEventListener?.("scroll", handleViewportScroll, { passive: true });
      windowObject?.visualViewport?.addEventListener?.("resize", schedule);
      windowObject?.visualViewport?.addEventListener?.("scroll", handleViewportScroll, {
        passive: true,
      });
      connected = true;
      return controller;
    }

    function disconnect() {
      finishKeyboardInteraction(false);
      cancelPointerInteractions();
      dragHandle?.removeEventListener?.("pointerdown", handleDragPointerDown);
      dragHandle?.removeEventListener?.("keydown", handleDragKeyDown);
      dragHandle?.removeEventListener?.("blur", handleDragBlur);
      resizeHandle?.removeEventListener?.("pointerdown", handleResizePointerDown);
      resizeHandle?.removeEventListener?.("dblclick", handleResizeDoubleClick);
      resizeHandle?.removeEventListener?.("keydown", handleResizeKeyDown);
      resizeHandle?.removeEventListener?.("blur", handleResizeBlur);
      windowObject?.removeEventListener?.("resize", schedule);
      windowObject?.removeEventListener?.("scroll", handleViewportScroll);
      windowObject?.visualViewport?.removeEventListener?.("resize", schedule);
      windowObject?.visualViewport?.removeEventListener?.("scroll", handleViewportScroll);
      cancelScheduledLayout();
      if (root?.isConnected) {
        movePlayerToOverlayRoot();
      }
      compactHost?.remove?.();
      compactHost = null;
      root = null;
      dragHandle = null;
      resizeHandle = null;
      trackElement = null;
      connected = false;
      view = {
        ...view,
        visible: false,
      };
    }

    function hydrate(settings = {}) {
      const wasAvoidingVideoTitleOverlap = avoidVideoTitleOverlap;
      playerPosition = settings.floatingPlayerPosition || null;
      playerSize = settings.floatingPlayerSize || null;
      anchoredWidth = settings.anchoredPlayerSize?.width ?? null;
      anchoredHeight = settings.anchoredPlayerSize?.height ?? null;
      compactWidth = settings.compactPlayerWidth ?? null;
      avoidVideoTitleOverlap = settings.avoidVideoTitleOverlap !== false;
      if (!wasAvoidingVideoTitleOverlap && avoidVideoTitleOverlap) {
        compactManualOverride = false;
      }
      return controller;
    }

    function beginVideoSession(sessionKey = null) {
      compactVideoSessionKey = sessionKey;
      compactManualOverride = false;
      effectiveCompactWidth = null;
      return controller;
    }

    function prepareMount({ inlineCompact = false } = {}) {
      movePlayerToOverlayRoot();
      if (inlineCompact) {
        removeEmptyCompactHost();
        clearPlayerSize();
        effectiveCompactWidth = null;
        clearRootPosition();
        return true;
      }

      return false;
    }

    function layoutNow(nextView = null) {
      if (nextView) {
        const candidateView = {
          ...view,
          ...nextView,
        };
        if (keyboardInteraction && !keyboardInteractionMatchesView(candidateView)) {
          finishKeyboardInteraction(false);
        }
        view = candidateView;
      }
      if (!root || !view.visible) {
        return false;
      }

      if (view.inlineCompact) {
        if (!positionCompactPlayer() && !mountCompactFallback()) {
          positionAnchoredPlayer();
        }
        return true;
      }

      effectiveCompactWidth = null;

      if (view.panelMode === PANEL_MODES.ANCHORED) {
        positionAnchoredPlayer();
      } else {
        positionFloatingPlayer();
      }
      return true;
    }

    function schedule() {
      if (!view.visible || !root || playerLayoutFrame !== null || typeof requestFrame !== "function") {
        return false;
      }

      playerLayoutFrame = requestFrame(() => {
        playerLayoutFrame = null;
        layoutNow();
      });
      return true;
    }

    function handleViewportScroll() {
      if (view.panelMode !== PANEL_MODES.ANCHORED) {
        return false;
      }
      return schedule();
    }

    function cancelScheduledLayout() {
      if (playerLayoutFrame === null) {
        return false;
      }
      if (typeof cancelFrame === "function") {
        cancelFrame(playerLayoutFrame);
      }
      playerLayoutFrame = null;
      return true;
    }

    function ensureFloatingPositionFromCurrentRect() {
      if (playerPosition) {
        return { ...playerPosition };
      }
      if (!root) {
        return null;
      }
      const rect = root.getBoundingClientRect();
      playerPosition = clampPlayerPosition(rect.left, rect.top, rect.width, rect.height);
      return { ...playerPosition };
    }

    function resetMount() {
      movePlayerToOverlayRoot();
      compactHost?.remove?.();
    }

    function movePlayerToOverlayRoot() {
      const documentElement = documentObject?.documentElement;
      if (root && documentElement && root.parentElement !== documentElement) {
        documentElement.append(root);
      }
    }

    function removeEmptyCompactHost() {
      if (compactHost?.isConnected && !compactHost.contains(root)) {
        compactHost.remove();
      }
    }

    function positionFloatingPlayer() {
      if (playerSize) {
        applyPlayerSize(clampPlayerSize(playerSize.width, playerSize.height));
      } else {
        clearPlayerSize();
      }

      if (playerPosition) {
        positionPlayer(playerPosition.left, playerPosition.top);
        return;
      }

      const rect = root.getBoundingClientRect();
      const position = getDefaultFloatingPosition(rect.width, rect.height);
      applyPlayerPosition(position);
    }

    function positionAnchoredPlayer() {
      const launcher = getLauncherElement();
      const anchorRect = launcher?.isConnected ? launcher.getBoundingClientRect() : null;
      const alignmentRect = findCompactActionAnchor()?.getBoundingClientRect() || anchorRect;

      if (anchoredWidth || anchoredHeight) {
        const currentRect = root.getBoundingClientRect();
        renderAnchoredPlayerSize(
          // Preserve the existing normal-layout behavior: active pointer resizing
          // supplies anchorRect for height clamping, while ordinary layout does not.
          clampAnchoredPlayerSize(
            anchoredWidth ?? currentRect.width,
            anchoredHeight ?? currentRect.height,
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

      const preferredWidth = renderPreferredCompactPlayerWidth(actionRect);
      let rect = root.getBoundingClientRect();
      if (!actionRect || actionRect.width <= 0 || actionRect.height <= 0 || rect.width <= 0 || rect.height <= 0) {
        clearRootPosition();
        return false;
      }

      const automaticWidth = resolveAutomaticCompactWidth(preferredWidth, actionRect);
      if (Math.abs(automaticWidth - rect.width) >= 0.5) {
        renderCompactPlayerWidth(automaticWidth);
        rect = root.getBoundingClientRect();
      } else {
        effectiveCompactWidth = rect.width;
      }

      const scrollOffset = getViewportScrollOffset();
      const viewport = getViewportSize();
      const minLeft = DRAG_VIEWPORT_PADDING;
      const maxLeft = Math.max(minLeft, viewport.width - rect.width - DRAG_VIEWPORT_PADDING);
      const left = clamp(actionRect.right - rect.width, minLeft, maxLeft) + scrollOffset.left;
      const top = Math.max(
        0,
        actionRect.top + scrollOffset.top - rect.height - COMPACT_ANCHOR_GAP
      );

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

      renderPreferredCompactPlayerWidth();

      clearRootPosition();
      return true;
    }

    function ensureCompactHost(actionRow) {
      if (!compactHost) {
        compactHost = documentObject.createElement("div");
        compactHost.id = COMPACT_HOST_ID;
      }

      const launcher = getLauncherElement();
      if (compactHost.parentElement === actionRow && launcher?.nextSibling === compactHost) {
        return compactHost;
      }

      if (launcher?.nextSibling) {
        actionRow.insertBefore(compactHost, launcher.nextSibling);
      } else {
        actionRow.append(compactHost);
      }
      return compactHost;
    }

    function positionPlayer(left, top) {
      const rect = root.getBoundingClientRect();
      applyPlayerPosition(clampPlayerPosition(left, top, rect.width, rect.height));
    }

    function applyPlayerPosition(position) {
      playerPosition = position;
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
      if (!root) {
        return;
      }
      root.style.position = "";
      root.style.left = "";
      root.style.top = "";
      root.style.right = "";
      root.style.bottom = "";
    }

    function applyPlayerSize(size) {
      playerSize = size;
      root.classList.add("has-custom-size");
      root.style.width = `${size.width}px`;
      root.style.height = `${size.height}px`;
    }

    function clearPlayerSize() {
      if (!root) {
        return;
      }
      root.classList.remove("has-custom-size");
      root.style.width = "";
      root.style.height = "";
    }

    function applyAnchoredPlayerSize(size) {
      anchoredWidth = size.width;
      anchoredHeight = size.height;
      renderAnchoredPlayerSize(size);
    }

    function renderAnchoredPlayerSize(size) {
      root.classList.add("has-custom-size");
      root.style.width = `${size.width}px`;
      root.style.height = `${size.height}px`;
    }

    function applyCompactPlayerWidth(width) {
      compactWidth = width;
      renderCompactPlayerWidth(width);
    }

    function renderCompactPlayerWidth(width) {
      effectiveCompactWidth = width;
      root.classList.remove("has-custom-size");
      root.style.width = `${width}px`;
      root.style.height = "";
    }

    function renderPreferredCompactPlayerWidth(alignmentRect = null) {
      if (compactWidth !== null) {
        const preferredWidth = clampCompactPlayerWidth(compactWidth, alignmentRect);
        renderCompactPlayerWidth(preferredWidth);
        return preferredWidth;
      }

      clearPlayerSize();
      const naturalWidth = root.getBoundingClientRect().width;
      const preferredWidth = clampCompactPlayerWidth(naturalWidth, alignmentRect);
      if (Math.abs(preferredWidth - naturalWidth) >= 0.5) {
        renderCompactPlayerWidth(preferredWidth);
      } else {
        effectiveCompactWidth = naturalWidth;
      }
      return preferredWidth;
    }

    function resolveAutomaticCompactWidth(preferredWidth, actionRect) {
      if (!avoidVideoTitleOverlap || compactManualOverride) {
        return preferredWidth;
      }

      let titleRects;
      try {
        titleRects = getVideoTitleLineRects() || [];
      } catch (_error) {
        return preferredWidth;
      }
      const renderedTitleRects = [...titleRects].filter((rect) => {
        return rect
          && Number.isFinite(rect.right)
          && Number.isFinite(rect.bottom);
      });
      if (renderedTitleRects.length === 0) {
        return preferredWidth;
      }

      const bottomMostTitleLine = Math.max(...renderedTitleRects.map((rect) => rect.bottom));
      const titleRight = Math.max(...renderedTitleRects
        .filter((rect) => rect.bottom >= bottomMostTitleLine - COMPACT_TITLE_LINE_TOLERANCE)
        .map((rect) => rect.right));
      const viewportRight = getViewportSize().width - DRAG_VIEWPORT_PADDING;
      const playerRight = Math.min(actionRect.right, viewportRight);
      const safeWidth = playerRight - titleRight - COMPACT_TITLE_GAP;
      return Math.min(
        preferredWidth,
        clampCompactPlayerWidth(safeWidth, actionRect)
      );
    }

    function saveFloatingPlayerLayout() {
      saveSettings({
        floatingPlayerPosition: playerPosition,
        floatingPlayerSize: playerSize,
      });
    }

    function saveAnchoredPlayerLayout() {
      saveSettings({
        anchoredPlayerSize: anchoredWidth && anchoredHeight
          ? { width: anchoredWidth, height: anchoredHeight }
          : null,
      });
    }

    function saveCompactPlayerLayout() {
      saveSettings({ compactPlayerWidth: compactWidth });
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
      const physicalMaxWidth = Math.max(PLAYER_MIN_VISIBLE_WIDTH, maxViewportWidth);
      const minimumWidth = Math.min(COMPACT_PLAYER_MIN_WIDTH, physicalMaxWidth);
      const alignmentRight = alignmentRect?.right ?? viewport.width - DRAG_VIEWPORT_PADDING;
      const maxCompactWidth = alignmentRight - DRAG_VIEWPORT_PADDING;
      const maxWidth = Math.max(
        minimumWidth,
        Math.min(physicalMaxWidth, maxCompactWidth)
      );

      return clamp(width, minimumWidth, maxWidth);
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
        width: windowObject?.visualViewport?.width ?? windowObject?.innerWidth ?? 0,
        height: windowObject?.visualViewport?.height ?? windowObject?.innerHeight ?? 0,
      };
    }

    function getViewportScrollOffset() {
      return {
        left: windowObject?.scrollX || windowObject?.pageXOffset || 0,
        top: windowObject?.scrollY || windowObject?.pageYOffset || 0,
      };
    }

    function handleDragKeyDown(event) {
      handleKeyboardLayoutKey(event, "drag");
    }

    function handleResizeKeyDown(event) {
      if (getCurrentResizeMode() === RESIZE_MODES.COMPACT_WIDTH) {
        return;
      }
      handleKeyboardLayoutKey(event, "resize");
    }

    function handleDragBlur() {
      if (keyboardInteraction?.kind === "drag") {
        finishKeyboardInteraction(false);
      }
    }

    function handleResizeBlur() {
      if (keyboardInteraction?.kind === "resize") {
        finishKeyboardInteraction(false);
      }
    }

    function handleKeyboardLayoutKey(event, kind) {
      const key = event.key === "Spacebar" ? " " : event.key;
      const active = keyboardInteraction?.kind === kind;
      if (!active) {
        if ((key === "Enter" || key === " ") && !event.repeat) {
          if (keyboardInteraction) {
            finishKeyboardInteraction(false);
          }
          const started = kind === "drag"
            ? startKeyboardDrag()
            : startKeyboardResize();
          if (started) {
            consumeKeyboardEvent(event);
          }
        }
        return;
      }

      if (key === "Enter") {
        consumeKeyboardEvent(event);
        if (!event.repeat) {
          finishKeyboardInteraction(true);
        }
        return;
      }
      if (key === " ") {
        consumeKeyboardEvent(event);
        return;
      }
      if (key === "Escape") {
        consumeKeyboardEvent(event);
        finishKeyboardInteraction(false);
        return;
      }
      if (key === "Home") {
        consumeKeyboardEvent(event);
        resetKeyboardInteraction();
        return;
      }
      if (!["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp"].includes(key)) {
        return;
      }

      consumeKeyboardEvent(event);
      const step = event.shiftKey ? KEYBOARD_LAYOUT_FINE_STEP : KEYBOARD_LAYOUT_STEP;
      if (kind === "drag") {
        movePlayerFromKeyboard(key, step);
      } else {
        resizePlayerFromKeyboard(key, step);
      }
    }

    function consumeKeyboardEvent(event) {
      event.preventDefault();
      event.stopPropagation?.();
    }

    function startKeyboardDrag() {
      if (
        !root
        || !dragHandle
        || !view.visible
        || view.panelMode !== PANEL_MODES.FLOATING
        || dragPointerId !== null
        || resizePointerId !== null
      ) {
        return false;
      }

      const snapshot = captureLayoutSnapshot();
      const rect = root.getBoundingClientRect();
      applyPlayerPosition(clampPlayerPosition(rect.left, rect.top, rect.width, rect.height));
      keyboardInteraction = {
        kind: "drag",
        reset: false,
        resizeMode: null,
        snapshot,
      };
      root.classList.add("is-dragging");
      dragHandle.setAttribute?.("aria-pressed", "true");
      return true;
    }

    function startKeyboardResize() {
      const mode = getCurrentResizeMode();
      if (
        !root
        || !resizeHandle
        || !view.visible
        || !mode
        || mode === RESIZE_MODES.COMPACT_WIDTH
        || dragPointerId !== null
        || resizePointerId !== null
      ) {
        return false;
      }

      const snapshot = captureLayoutSnapshot();
      const rect = root.getBoundingClientRect();
      if (mode === RESIZE_MODES.ANCHORED) {
        const { alignmentRect, anchorRect } = getResizeAnchors();
        applyAnchoredPlayerSize(
          clampAnchoredPlayerSize(rect.width, rect.height, alignmentRect, anchorRect)
        );
        layoutNow();
      } else if (mode === RESIZE_MODES.COMPACT_WIDTH) {
        const { alignmentRect } = getResizeAnchors();
        applyCompactPlayerWidth(clampCompactPlayerWidth(rect.width, alignmentRect));
        layoutNow();
      } else {
        const size = clampPlayerSize(rect.width, rect.height);
        applyPlayerPosition(clampPlayerPosition(rect.left, rect.top, size.width, size.height));
        applyPlayerSize(size);
      }

      keyboardInteraction = {
        kind: "resize",
        reset: false,
        resizeMode: mode,
        snapshot,
      };
      root.classList.add("is-resizing");
      resizeHandle.setAttribute?.("aria-pressed", "true");
      return true;
    }

    function movePlayerFromKeyboard(key, step) {
      if (keyboardInteraction?.kind !== "drag" || !root) {
        return false;
      }

      const rect = root.getBoundingClientRect();
      const horizontal = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
      const vertical = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
      applyPlayerPosition(
        clampPlayerPosition(
          rect.left + horizontal,
          rect.top + vertical,
          rect.width,
          rect.height
        )
      );
      keyboardInteraction.reset = false;
      return true;
    }

    function resizePlayerFromKeyboard(key, step) {
      const mode = keyboardInteraction?.resizeMode;
      if (keyboardInteraction?.kind !== "resize" || !root || !mode) {
        return false;
      }

      const rect = root.getBoundingClientRect();
      const width = rect.width
        + (key === "ArrowLeft" ? step : key === "ArrowRight" ? -step : 0);
      const height = rect.height
        + (key === "ArrowUp" ? step : key === "ArrowDown" ? -step : 0);
      const { alignmentRect, anchorRect } = getResizeAnchors();
      if (mode === RESIZE_MODES.ANCHORED) {
        applyAnchoredPlayerSize(
          clampAnchoredPlayerSize(width, height, alignmentRect, anchorRect)
        );
        layoutNow();
      } else if (mode === RESIZE_MODES.COMPACT_WIDTH) {
        if (key === "ArrowLeft" || key === "ArrowRight") {
          applyCompactPlayerWidth(clampCompactPlayerWidth(width, alignmentRect));
          layoutNow();
        }
      } else {
        const size = clampTopLeftResizeSize(width, height, rect.right, rect.bottom);
        applyPlayerPosition({
          left: rect.right - size.width,
          top: rect.bottom - size.height,
        });
        applyPlayerSize(size);
      }
      keyboardInteraction.reset = false;
      return true;
    }

    function resetKeyboardInteraction() {
      if (!keyboardInteraction || !root) {
        return false;
      }

      if (keyboardInteraction.kind === "drag") {
        const rect = root.getBoundingClientRect();
        applyPlayerPosition(getDefaultFloatingPosition(rect.width, rect.height));
      } else if (keyboardInteraction.resizeMode === RESIZE_MODES.ANCHORED) {
        anchoredWidth = null;
        anchoredHeight = null;
        clearPlayerSize();
        layoutNow();
      } else if (keyboardInteraction.resizeMode === RESIZE_MODES.COMPACT_WIDTH) {
        compactWidth = null;
        clearPlayerSize();
        layoutNow();
      } else {
        playerSize = null;
        clearPlayerSize();
        const rect = root.getBoundingClientRect();
        positionPlayer(rect.left, rect.top);
      }
      keyboardInteraction.reset = true;
      return true;
    }

    function finishKeyboardInteraction(commit) {
      const interaction = keyboardInteraction;
      if (!interaction) {
        return false;
      }

      keyboardInteraction = null;
      root?.classList.remove(interaction.kind === "drag" ? "is-dragging" : "is-resizing");
      dragHandle?.setAttribute?.("aria-pressed", "false");
      resizeHandle?.setAttribute?.("aria-pressed", "false");
      if (!commit) {
        restoreLayoutSnapshot(interaction);
        return true;
      }

      if (interaction.kind === "drag") {
        if (interaction.reset) {
          playerPosition = null;
        }
        saveFloatingPlayerLayout();
      } else if (interaction.resizeMode === RESIZE_MODES.ANCHORED) {
        saveAnchoredPlayerLayout();
      } else if (interaction.resizeMode === RESIZE_MODES.COMPACT_WIDTH) {
        saveCompactPlayerLayout();
      } else {
        saveFloatingPlayerLayout();
      }
      return true;
    }

    function captureLayoutSnapshot() {
      const rect = root.getBoundingClientRect();
      return {
        anchoredHeight,
        anchoredWidth,
        compactWidth,
        playerPosition: playerPosition ? { ...playerPosition } : null,
        playerSize: playerSize ? { ...playerSize } : null,
        rect: {
          height: rect.height,
          left: rect.left,
          top: rect.top,
          width: rect.width,
        },
      };
    }

    function restoreLayoutSnapshot(interaction) {
      const snapshot = interaction.snapshot;
      anchoredHeight = snapshot.anchoredHeight;
      anchoredWidth = snapshot.anchoredWidth;
      compactWidth = snapshot.compactWidth;
      playerPosition = snapshot.playerPosition ? { ...snapshot.playerPosition } : null;
      playerSize = snapshot.playerSize ? { ...snapshot.playerSize } : null;

      if (interaction.kind === "drag") {
        restoreFloatingPosition(snapshot);
        return;
      }
      if (interaction.resizeMode === RESIZE_MODES.FLOATING) {
        if (snapshot.playerSize) {
          applyPlayerSize(snapshot.playerSize);
        } else {
          playerSize = null;
          clearPlayerSize();
        }
        restoreFloatingPosition(snapshot);
        return;
      }

      clearPlayerSize();
      layoutNow();
    }

    function restoreFloatingPosition(snapshot) {
      if (snapshot.playerPosition) {
        applyPlayerPosition(snapshot.playerPosition);
        return;
      }
      applyRootPosition({ left: snapshot.rect.left, top: snapshot.rect.top });
      playerPosition = null;
    }

    function getCurrentResizeMode() {
      return getResizeModeForView(view);
    }

    function getResizeModeForView(candidateView) {
      if (candidateView.panelMode === PANEL_MODES.FLOATING) {
        return RESIZE_MODES.FLOATING;
      }
      if (candidateView.panelMode === PANEL_MODES.ANCHORED && candidateView.anchoredCompact) {
        return RESIZE_MODES.COMPACT_WIDTH;
      }
      if (candidateView.panelMode === PANEL_MODES.ANCHORED) {
        return RESIZE_MODES.ANCHORED;
      }
      return null;
    }

    function keyboardInteractionMatchesView(candidateView) {
      if (!candidateView.visible) {
        return false;
      }
      if (keyboardInteraction.kind === "drag") {
        return candidateView.panelMode === PANEL_MODES.FLOATING;
      }
      return keyboardInteraction.resizeMode === getResizeModeForView(candidateView);
    }

    function getResizeAnchors() {
      const launcher = getLauncherElement();
      return {
        alignmentRect: findCompactActionAnchor()?.getBoundingClientRect()
          || (launcher?.isConnected ? launcher.getBoundingClientRect() : null),
        anchorRect: launcher?.isConnected ? launcher.getBoundingClientRect() : null,
      };
    }

    function getDefaultFloatingPosition(width, height) {
      const viewport = getViewportSize();
      return clampPlayerPosition(
        viewport.width - width - 18,
        viewport.height - height - 88,
        width,
        height
      );
    }

    function handleDragPointerDown(event) {
      if (view.panelMode !== PANEL_MODES.FLOATING || !root || !dragHandle) {
        return;
      }
      if (event.button !== undefined && event.button !== 0) {
        return;
      }

      finishKeyboardInteraction(false);
      dragHandle.focus?.({ preventScroll: true });
      event.preventDefault();
      const rect = root.getBoundingClientRect();
      dragPointerId = event.pointerId;
      dragOffsetX = event.clientX - rect.left;
      dragOffsetY = event.clientY - rect.top;
      root.classList.add("is-dragging");
      safelySetPointerCapture(dragHandle, event.pointerId);
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

      safelyReleasePointerCapture(dragHandle, event.pointerId);
      dragPointerId = null;
      root?.classList.remove("is-dragging");
      dragHandle?.removeEventListener?.("pointermove", handleDragPointerMove);
      dragHandle?.removeEventListener?.("pointerup", handleDragPointerEnd);
      dragHandle?.removeEventListener?.("pointercancel", handleDragPointerEnd);
      saveFloatingPlayerLayout();
    }

    function handleResizePointerDown(event) {
      if (!root || !resizeHandle) {
        return;
      }
      const isAnchoredResize = view.panelMode === PANEL_MODES.ANCHORED && !view.anchoredCompact;
      const isCompactResize = view.panelMode === PANEL_MODES.ANCHORED && view.anchoredCompact;
      if (view.panelMode !== PANEL_MODES.FLOATING && !isAnchoredResize && !isCompactResize) {
        return;
      }
      if (event.button !== undefined && event.button !== 0) {
        return;
      }

      finishKeyboardInteraction(false);
      if (!isCompactResize) {
        resizeHandle.focus?.({ preventScroll: true });
      }
      event.preventDefault();
      const rect = root.getBoundingClientRect();
      const launcher = getLauncherElement();
      const alignmentRect = findCompactActionAnchor()?.getBoundingClientRect()
        || (launcher?.isConnected ? launcher.getBoundingClientRect() : null);
      const anchorRect = launcher?.isConnected ? launcher.getBoundingClientRect() : null;
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
      compactResizeChanged = false;

      if (resizeMode === RESIZE_MODES.ANCHORED) {
        applyAnchoredPlayerSize(size);
        layoutNow();
      } else if (resizeMode === RESIZE_MODES.FLOATING) {
        applyPlayerPosition(position);
        applyPlayerSize(size);
      }

      root.classList.add("is-resizing");
      safelySetPointerCapture(resizeHandle, event.pointerId);
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
        const launcher = getLauncherElement();
        const alignmentRect = findCompactActionAnchor()?.getBoundingClientRect()
          || (launcher?.isConnected ? launcher.getBoundingClientRect() : null);
        const anchorRect = launcher?.isConnected ? launcher.getBoundingClientRect() : null;
        applyAnchoredPlayerSize(
          clampAnchoredPlayerSize(
            resizeStartWidth + resizeStartX - event.clientX,
            resizeStartHeight + resizeStartY - event.clientY,
            alignmentRect,
            anchorRect
          )
        );
        layoutNow();
        return;
      }

      if (resizeMode === RESIZE_MODES.COMPACT_WIDTH) {
        const launcher = getLauncherElement();
        const alignmentRect = findCompactActionAnchor()?.getBoundingClientRect()
          || (launcher?.isConnected ? launcher.getBoundingClientRect() : null);
        const nextWidth = clampCompactPlayerWidth(
          resizeStartWidth + resizeStartX - event.clientX,
          alignmentRect
        );
        if (Math.abs(nextWidth - root.getBoundingClientRect().width) < 0.5) {
          return;
        }
        compactResizeChanged = true;
        compactManualOverride = true;
        applyCompactPlayerWidth(nextWidth);
        layoutNow();
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
      layoutNow();
    }

    function handleResizePointerEnd(event) {
      if (resizePointerId !== null && event.pointerId !== resizePointerId) {
        return;
      }

      const completedResizeMode = resizeMode;
      safelyReleasePointerCapture(resizeHandle, event.pointerId);
      resizePointerId = null;
      resizeMode = null;
      root?.classList.remove("is-resizing");
      resizeHandle?.removeEventListener?.("pointermove", handleResizePointerMove);
      resizeHandle?.removeEventListener?.("pointerup", handleResizePointerEnd);
      resizeHandle?.removeEventListener?.("pointercancel", handleResizePointerEnd);

      if (completedResizeMode === RESIZE_MODES.ANCHORED) {
        saveAnchoredPlayerLayout();
      } else if (completedResizeMode === RESIZE_MODES.COMPACT_WIDTH && compactResizeChanged) {
        saveCompactPlayerLayout();
      } else if (completedResizeMode === RESIZE_MODES.FLOATING) {
        saveFloatingPlayerLayout();
      }
      compactResizeChanged = false;
    }

    function handleResizeDoubleClick(event) {
      if (
        !root
        || !trackElement
        || !view.visible
        || !view.inlineCompact
        || getCurrentResizeMode() !== RESIZE_MODES.COMPACT_WIDTH
        || resizePointerId !== null
        || (event.button !== undefined && event.button !== 0)
      ) {
        return false;
      }

      const trackLabel = String(trackElement.title || "").trim();
      const rootRect = root.getBoundingClientRect();
      const trackRect = trackElement.getBoundingClientRect?.();
      const textWidth = measureRenderedTextWidth(trackElement);
      if (
        !trackLabel
        || !trackRect
        || rootRect.width <= 0
        || trackRect.width <= 0
        || !Number.isFinite(textWidth)
        || textWidth <= 0
      ) {
        return false;
      }

      event.preventDefault?.();
      event.stopPropagation?.();
      const { alignmentRect } = getResizeAnchors();
      const fixedWidth = Math.max(0, rootRect.width - trackRect.width);
      const fittedWidth = clampCompactPlayerWidth(
        Math.ceil(fixedWidth + textWidth + COMPACT_FIT_TEXT_PADDING),
        alignmentRect
      );
      compactManualOverride = false;
      applyCompactPlayerWidth(fittedWidth);
      layoutNow();
      saveCompactPlayerLayout();
      return true;
    }

    function measureRenderedTextWidth(element) {
      const range = documentObject?.createRange?.();
      if (!range) {
        return Number(element?.scrollWidth) || 0;
      }
      try {
        range.selectNodeContents(element);
        return Number(range.getBoundingClientRect?.().width) || 0;
      } catch (_error) {
        return Number(element?.scrollWidth) || 0;
      } finally {
        range.detach?.();
      }
    }

    function cancelPointerInteractions() {
      if (dragPointerId !== null) {
        safelyReleasePointerCapture(dragHandle, dragPointerId);
      }
      dragHandle?.removeEventListener?.("pointermove", handleDragPointerMove);
      dragHandle?.removeEventListener?.("pointerup", handleDragPointerEnd);
      dragHandle?.removeEventListener?.("pointercancel", handleDragPointerEnd);
      root?.classList.remove("is-dragging");
      dragPointerId = null;

      if (resizePointerId !== null) {
        safelyReleasePointerCapture(resizeHandle, resizePointerId);
      }
      resizeHandle?.removeEventListener?.("pointermove", handleResizePointerMove);
      resizeHandle?.removeEventListener?.("pointerup", handleResizePointerEnd);
      resizeHandle?.removeEventListener?.("pointercancel", handleResizePointerEnd);
      root?.classList.remove("is-resizing");
      resizePointerId = null;
      resizeMode = null;
      compactResizeChanged = false;
    }

    function safelySetPointerCapture(element, pointerId) {
      try {
        element?.setPointerCapture?.(pointerId);
      } catch (_error) {
        // The pointer can disappear while YouTube reparents the compact player.
      }
    }

    function safelyReleasePointerCapture(element, pointerId) {
      try {
        if (
          typeof element?.hasPointerCapture === "function"
          && !element.hasPointerCapture(pointerId)
        ) {
          return;
        }
        element?.releasePointerCapture?.(pointerId);
      } catch (_error) {
        // A detached handle or already-ended pointer needs no further cleanup.
      }
    }

    function ownsNode(node) {
      if (!node) {
        return false;
      }
      return node === root
        || root?.contains?.(node) === true
        || node === compactHost
        || compactHost?.contains?.(node) === true;
    }

    function getSnapshot() {
      return {
        anchoredHeight,
        anchoredWidth,
        avoidVideoTitleOverlap,
        compactHost,
        compactManualOverride,
        compactVideoSessionKey,
        compactWidth,
        connected,
        dragPointerId,
        framePending: playerLayoutFrame !== null,
        effectiveCompactWidth,
        keyboardMode: keyboardInteraction?.kind || null,
        keyboardReset: keyboardInteraction?.reset || false,
        playerPosition: playerPosition ? { ...playerPosition } : null,
        playerSize: playerSize ? { ...playerSize } : null,
        resizeMode,
        resizePointerId,
        view: { ...view },
      };
    }

    const controller = {
      beginVideoSession,
      cancelScheduledLayout,
      connect,
      disconnect,
      getSnapshot,
      hydrate,
      layoutNow,
      ownsNode,
      prepareMount,
      resetMount,
      schedule,
      ensureFloatingPositionFromCurrentRect,
    };
    return controller;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  globalThis.TimestampPlayerPlayerLayout = {
    PANEL_MODES,
    createPlayerLayoutController,
  };
})();
