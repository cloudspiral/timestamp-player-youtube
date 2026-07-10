(() => {
  const COMPACT_HOST_ID = "timestamp-player-compact-host";
  const DRAG_VIEWPORT_PADDING = 8;
  const PLAYER_MIN_WIDTH = 260;
  const PLAYER_MIN_HEIGHT = 128;
  const PLAYER_MIN_VISIBLE_WIDTH = 180;
  const PLAYER_MIN_VISIBLE_HEIGHT = 100;
  const COMPACT_PLAYER_MIN_WIDTH = 300;
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
    requestFrame = windowObject?.requestAnimationFrame?.bind(windowObject),
    cancelFrame = windowObject?.cancelAnimationFrame?.bind(windowObject),
  } = {}) {
    let root = null;
    let dragHandle = null;
    let resizeHandle = null;
    let compactHost = null;
    let connected = false;

    let playerPosition = null;
    let playerSize = null;
    let anchoredWidth = null;
    let anchoredHeight = null;
    let compactWidth = null;
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
      if (
        connected
        && root === nextRoot
        && dragHandle === nextDragHandle
        && resizeHandle === nextResizeHandle
      ) {
        return controller;
      }

      if (connected || root || dragHandle || resizeHandle) {
        disconnect();
      }

      root = nextRoot;
      dragHandle = nextDragHandle;
      resizeHandle = nextResizeHandle;
      dragHandle?.addEventListener?.("pointerdown", handleDragPointerDown);
      resizeHandle?.addEventListener?.("pointerdown", handleResizePointerDown);
      windowObject?.addEventListener?.("resize", schedule);
      windowObject?.visualViewport?.addEventListener?.("resize", schedule);
      connected = true;
      return controller;
    }

    function disconnect() {
      cancelPointerInteractions();
      dragHandle?.removeEventListener?.("pointerdown", handleDragPointerDown);
      resizeHandle?.removeEventListener?.("pointerdown", handleResizePointerDown);
      windowObject?.removeEventListener?.("resize", schedule);
      windowObject?.visualViewport?.removeEventListener?.("resize", schedule);
      cancelScheduledLayout();
      if (root?.isConnected) {
        movePlayerToOverlayRoot();
      }
      compactHost?.remove?.();
      compactHost = null;
      root = null;
      dragHandle = null;
      resizeHandle = null;
      connected = false;
      view = {
        ...view,
        visible: false,
      };
    }

    function hydrate(settings = {}) {
      playerPosition = settings.floatingPlayerPosition || null;
      playerSize = settings.floatingPlayerSize || null;
      anchoredWidth = settings.anchoredPlayerSize?.width ?? null;
      anchoredHeight = settings.anchoredPlayerSize?.height ?? null;
      compactWidth = settings.compactPlayerWidth ?? null;
      return controller;
    }

    function prepareMount({ inlineCompact = false } = {}) {
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

    function layoutNow(nextView = null) {
      if (nextView) {
        view = {
          ...view,
          ...nextView,
        };
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

    function seedFloatingFromCurrentRect() {
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

      if (compactWidth) {
        renderCompactPlayerWidth(clampCompactPlayerWidth(compactWidth, actionRect));
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

      if (compactWidth) {
        renderCompactPlayerWidth(clampCompactPlayerWidth(compactWidth));
      } else {
        clearPlayerSize();
      }

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
      root.classList.remove("has-custom-size");
      root.style.width = `${width}px`;
      root.style.height = "";
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

    function handleDragPointerDown(event) {
      if (view.panelMode !== PANEL_MODES.FLOATING || !root || !dragHandle) {
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

      dragHandle?.releasePointerCapture?.(event.pointerId);
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

      if (resizeMode === RESIZE_MODES.ANCHORED) {
        applyAnchoredPlayerSize(size);
        layoutNow();
      } else if (resizeMode === RESIZE_MODES.COMPACT_WIDTH) {
        applyCompactPlayerWidth(size.width);
        layoutNow();
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
        applyCompactPlayerWidth(
          clampCompactPlayerWidth(resizeStartWidth + resizeStartX - event.clientX, alignmentRect)
        );
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
      resizeHandle?.releasePointerCapture?.(event.pointerId);
      resizePointerId = null;
      resizeMode = null;
      root?.classList.remove("is-resizing");
      resizeHandle?.removeEventListener?.("pointermove", handleResizePointerMove);
      resizeHandle?.removeEventListener?.("pointerup", handleResizePointerEnd);
      resizeHandle?.removeEventListener?.("pointercancel", handleResizePointerEnd);

      if (completedResizeMode === RESIZE_MODES.ANCHORED) {
        saveAnchoredPlayerLayout();
      } else if (completedResizeMode === RESIZE_MODES.COMPACT_WIDTH) {
        saveCompactPlayerLayout();
      } else if (completedResizeMode === RESIZE_MODES.FLOATING) {
        saveFloatingPlayerLayout();
      }
    }

    function cancelPointerInteractions() {
      if (dragPointerId !== null && dragHandle?.hasPointerCapture?.(dragPointerId)) {
        dragHandle.releasePointerCapture(dragPointerId);
      }
      dragHandle?.removeEventListener?.("pointermove", handleDragPointerMove);
      dragHandle?.removeEventListener?.("pointerup", handleDragPointerEnd);
      dragHandle?.removeEventListener?.("pointercancel", handleDragPointerEnd);
      root?.classList.remove("is-dragging");
      dragPointerId = null;

      if (resizePointerId !== null && resizeHandle?.hasPointerCapture?.(resizePointerId)) {
        resizeHandle.releasePointerCapture(resizePointerId);
      }
      resizeHandle?.removeEventListener?.("pointermove", handleResizePointerMove);
      resizeHandle?.removeEventListener?.("pointerup", handleResizePointerEnd);
      resizeHandle?.removeEventListener?.("pointercancel", handleResizePointerEnd);
      root?.classList.remove("is-resizing");
      resizePointerId = null;
      resizeMode = null;
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
        compactHost,
        compactWidth,
        connected,
        dragPointerId,
        framePending: playerLayoutFrame !== null,
        playerPosition: playerPosition ? { ...playerPosition } : null,
        playerSize: playerSize ? { ...playerSize } : null,
        resizeMode,
        resizePointerId,
        view: { ...view },
      };
    }

    const controller = {
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
      seedFloatingFromCurrentRect,
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
