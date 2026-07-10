(() => {
  const VIDEO_RESOLUTION_STATUSES = Object.freeze({
    AD_PLAYING: "ad-playing",
    NOT_FOUND: "not-found",
    READY: "ready",
    WAITING_FOR_DURATION: "waiting-for-duration",
    WAITING_FOR_OWNERSHIP: "waiting-for-ownership",
  });
  const VIDEO_PLAYER_KINDS = Object.freeze({
    AD: "ad",
    MINIPLAYER: "miniplayer",
    MUSIC: "music",
    PREVIEW: "preview",
    UNKNOWN: "unknown",
    WATCH: "watch",
  });
  const OWNERSHIP_RANKS = Object.freeze({
    "watch-current": 400,
    "music-current": 350,
    "music-primary": 300,
    "watch-pending": 100,
    rejected: 0,
  });
  const MINIPLAYER_SELECTORS = Object.freeze([
    "ytd-miniplayer",
    "#miniplayer",
    ".ytp-miniplayer-ui",
  ]);
  const PREVIEW_SELECTORS = Object.freeze([
    "ytd-video-preview",
    "ytd-reel-video-renderer",
    "#inline-preview-player",
    "[is-preview]",
  ]);
  const AD_VIDEO_SELECTORS = Object.freeze([
    ".video-ads",
    ".ytp-ad-player-overlay",
    "[data-ad-player]",
  ]);
  const MUSIC_PLAYER_SELECTORS = Object.freeze([
    "ytmusic-player",
    "ytmusic-player-page",
    "#player-page",
  ]);
  const MUSIC_PLAYER_PAGE_SELECTORS = Object.freeze([
    "ytmusic-player-page",
    "#player-page",
  ]);
  const WATCH_SHELL_SELECTOR = "ytd-watch-flexy";
  const PLAYER_CONTAINER_SELECTORS = Object.freeze([
    "#movie_player",
    ".html5-video-player",
  ]);
  const {
    getMusicPlayerVideoId,
    getWatchShellVideoId,
  } = globalThis.TimestampPlayerVideoOwnership;
  const {
    isElementTreeExplicitlyHidden,
  } = globalThis.TimestampPlayerDomVisibility;

  function describeVideoElement(element, {
    getComputedStyle: getComputedStyleFn = globalThis.getComputedStyle,
    hostname = globalThis.location?.hostname || "",
    order = 0,
  } = {}) {
    const miniplayerRoot = closestAny(element, MINIPLAYER_SELECTORS);
    const previewRoot = closestAny(element, PREVIEW_SELECTORS);
    const adVideoRoot = closestAny(element, AD_VIDEO_SELECTORS);
    const watchShell = element?.closest?.(WATCH_SHELL_SELECTOR) || null;
    const musicRoot = closestAny(element, MUSIC_PLAYER_SELECTORS);
    const musicPlayerPage = closestAny(element, MUSIC_PLAYER_PAGE_SELECTORS);
    const playerContainer = closestAny(element, PLAYER_CONTAINER_SELECTORS);
    const rect = element?.getBoundingClientRect?.() || { width: 0, height: 0 };
    const explicitlyHidden = isElementTreeExplicitlyHidden(element, getComputedStyleFn);
    const shellExplicitlyHidden = watchShell
      ? isElementTreeExplicitlyHidden(watchShell, getComputedStyleFn)
      : false;
    const isMainVideo = Boolean(
      element?.matches?.("video.html5-main-video")
      || element?.classList?.contains?.("html5-main-video")
    );
    const hasPrimaryPlayerStructure = Boolean(
      playerContainer
      && (
        watchShell
        || hostname === "music.youtube.com" && musicRoot
      )
    );
    const adShowing = Boolean(
      adVideoRoot
      || playerContainer?.classList?.contains?.("ad-showing")
      || playerContainer?.hasAttribute?.("ad-showing") === true
    );
    let playerKind = VIDEO_PLAYER_KINDS.UNKNOWN;
    if (miniplayerRoot) {
      playerKind = VIDEO_PLAYER_KINDS.MINIPLAYER;
    } else if (previewRoot) {
      playerKind = VIDEO_PLAYER_KINDS.PREVIEW;
    } else if (adVideoRoot) {
      playerKind = VIDEO_PLAYER_KINDS.AD;
    } else if (watchShell) {
      playerKind = VIDEO_PLAYER_KINDS.WATCH;
    } else if (hostname === "music.youtube.com" && musicRoot) {
      playerKind = VIDEO_PLAYER_KINDS.MUSIC;
    }

    return {
      adShowing,
      area: Math.max(0, Number(rect.width) || 0) * Math.max(0, Number(rect.height) || 0),
      connected: element?.isConnected !== false,
      currentSrc: String(element?.currentSrc || element?.src || ""),
      duration: Number(element?.duration),
      element,
      explicitlyHidden,
      hasPrimaryPlayerStructure,
      hostname,
      isMainVideo,
      musicVideoId: getMusicPlayerVideoId(musicPlayerPage),
      order,
      playerKind,
      readyState: Number.isFinite(element?.readyState) ? element.readyState : 0,
      shellActive: Boolean(watchShell && !shellExplicitlyHidden),
      shellVideoId: getWatchShellVideoId(watchShell),
      visible: !explicitlyHidden && rect.width > 0 && rect.height > 0,
    };
  }

  function selectActiveVideoCandidate(descriptors, {
    hostname = "",
    previousElement = null,
    videoId = "",
  } = {}) {
    let best = null;
    let bestOwnership = "rejected";
    for (const descriptor of descriptors || []) {
      const ownership = getCandidateOwnership(descriptor, { hostname, videoId });
      if (!isEligibleCandidate(descriptor, ownership)) {
        continue;
      }
      if (
        !best
        || compareCandidates(
          descriptor,
          ownership,
          best,
          bestOwnership,
          previousElement
        ) > 0
      ) {
        best = descriptor;
        bestOwnership = ownership;
      }
    }

    if (!best) {
      return {
        descriptor: null,
        element: null,
        reason: "no-eligible-video",
        status: VIDEO_RESOLUTION_STATUSES.NOT_FOUND,
      };
    }
    if (bestOwnership === "watch-pending") {
      return createResolution(
        best,
        VIDEO_RESOLUTION_STATUSES.WAITING_FOR_OWNERSHIP,
        "watch-shell-video-id-pending"
      );
    }
    if (best.adShowing) {
      return createResolution(
        best,
        VIDEO_RESOLUTION_STATUSES.AD_PLAYING,
        "main-player-ad-showing"
      );
    }
    if (!hasUsableDuration(best) || best.readyState < 1) {
      return createResolution(
        best,
        VIDEO_RESOLUTION_STATUSES.WAITING_FOR_DURATION,
        "video-duration-unavailable"
      );
    }

    return createResolution(
      best,
      VIDEO_RESOLUTION_STATUSES.READY,
      bestOwnership === "music-primary"
        ? "youtube-music-fallback"
        : bestOwnership === "music-current"
          ? "current-music-player"
          : "current-watch-player"
    );
  }

  function resolveActiveVideo({
    getComputedStyle: getComputedStyleFn = globalThis.getComputedStyle,
    hostname = globalThis.location?.hostname || "",
    previousElement = null,
    root = globalThis.document,
    videoId = "",
  } = {}) {
    const descriptors = [...(root?.querySelectorAll?.("video") || [])].map((element, order) => {
      return describeVideoElement(element, {
        getComputedStyle: getComputedStyleFn,
        hostname,
        order,
      });
    });
    return selectActiveVideoCandidate(descriptors, {
      hostname,
      previousElement,
      videoId,
    });
  }

  function getCandidateOwnership(descriptor, { hostname, videoId }) {
    if (descriptor.playerKind === VIDEO_PLAYER_KINDS.WATCH) {
      if (descriptor.shellVideoId) {
        return descriptor.shellVideoId === videoId ? "watch-current" : "rejected";
      }
      return "watch-pending";
    }
    if (
      hostname === "music.youtube.com"
      && descriptor.hostname === "music.youtube.com"
      && descriptor.playerKind === VIDEO_PLAYER_KINDS.MUSIC
    ) {
      if (descriptor.musicVideoId) {
        return descriptor.musicVideoId === videoId ? "music-current" : "rejected";
      }
      return "music-primary";
    }
    return "rejected";
  }

  function isEligibleCandidate(descriptor, ownership) {
    return Boolean(
      descriptor
      && descriptor.connected
      && !descriptor.explicitlyHidden
      && (descriptor.isMainVideo || descriptor.hasPrimaryPlayerStructure)
      && ownership !== "rejected"
      && descriptor.playerKind !== VIDEO_PLAYER_KINDS.AD
      && descriptor.playerKind !== VIDEO_PLAYER_KINDS.MINIPLAYER
      && descriptor.playerKind !== VIDEO_PLAYER_KINDS.PREVIEW
    );
  }

  function compareCandidates(left, leftOwnership, right, rightOwnership, previousElement) {
    const leftRank = candidateRank(left, leftOwnership, previousElement);
    const rightRank = candidateRank(right, rightOwnership, previousElement);
    for (let index = 0; index < leftRank.length; index += 1) {
      if (leftRank[index] !== rightRank[index]) {
        return leftRank[index] - rightRank[index];
      }
    }
    return 0;
  }

  function candidateRank(descriptor, ownership, previousElement) {
    return [
      OWNERSHIP_RANKS[ownership] || 0,
      descriptor.shellActive || ownership.startsWith("music-") ? 1 : 0,
      descriptor.visible ? 1 : 0,
      descriptor.adShowing ? 0 : 1,
      hasUsableDuration(descriptor) ? 1 : 0,
      descriptor.readyState >= 1 ? 1 : 0,
      descriptor.readyState,
      descriptor.isMainVideo ? 1 : 0,
      descriptor.currentSrc ? 1 : 0,
      descriptor.area,
      descriptor.element === previousElement ? 1 : 0,
      -descriptor.order,
    ];
  }

  function hasUsableDuration(descriptor) {
    return Number.isFinite(descriptor.duration) && descriptor.duration > 0;
  }

  function createResolution(descriptor, status, reason) {
    return {
      descriptor,
      element: descriptor.element,
      reason,
      status,
    };
  }

  function closestAny(element, selectors) {
    for (const selector of selectors) {
      const match = element?.closest?.(selector);
      if (match) {
        return match;
      }
    }
    return null;
  }
  globalThis.TimestampPlayerVideoResolver = {
    VIDEO_PLAYER_KINDS,
    VIDEO_RESOLUTION_STATUSES,
    describeVideoElement,
    resolveActiveVideo,
    selectActiveVideoCandidate,
  };
})();
