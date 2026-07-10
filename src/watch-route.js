(() => {
  const SUPPORTED_HOSTS = new Set([
    "www.youtube.com",
    "music.youtube.com",
  ]);
  const DEFAULT_POLL_INTERVAL_MS = 1000;

  function getWatchVideoId(urlValue) {
    let url;
    try {
      url = new URL(urlValue);
    } catch {
      return null;
    }

    if (!SUPPORTED_HOSTS.has(url.hostname) || url.pathname !== "/watch") {
      return null;
    }

    const videoId = url.searchParams.get("v")?.trim();
    return videoId || null;
  }

  function createWatchRouteController({
    eventTargets = [],
    getUrl,
    onEnter = () => {},
    onLeave = () => {},
    onNavigate = () => {},
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    setIntervalFn = globalThis.setInterval,
    clearIntervalFn = globalThis.clearInterval,
  }) {
    let activeVideoId = null;
    let intervalId = null;
    let lastUrl = null;
    let started = false;

    function evaluate() {
      const url = String(getUrl());
      const previousUrl = lastUrl;
      const previousVideoId = activeVideoId;
      const videoId = getWatchVideoId(url);
      lastUrl = url;

      if (!previousVideoId && videoId) {
        activeVideoId = videoId;
        onEnter({ previousUrl, url, videoId });
        return;
      }

      if (previousVideoId && !videoId) {
        activeVideoId = null;
        onLeave({ previousVideoId, previousUrl, url });
        return;
      }

      if (previousVideoId && videoId && videoId !== previousVideoId) {
        activeVideoId = videoId;
        onNavigate({ previousVideoId, previousUrl, url, videoId });
      }
    }

    function handleNavigationEvent() {
      evaluate();
    }

    function start() {
      if (started) {
        return;
      }

      started = true;
      for (const target of eventTargets) {
        target?.addEventListener?.("yt-navigate-finish", handleNavigationEvent);
      }
      intervalId = setIntervalFn(() => evaluate(), pollIntervalMs);
      evaluate();
    }

    function stop() {
      if (!started) {
        return;
      }

      started = false;
      for (const target of eventTargets) {
        target?.removeEventListener?.("yt-navigate-finish", handleNavigationEvent);
      }
      if (intervalId !== null) {
        clearIntervalFn(intervalId);
        intervalId = null;
      }
      if (activeVideoId) {
        const previousVideoId = activeVideoId;
        activeVideoId = null;
        onLeave({ previousVideoId, previousUrl: lastUrl, url: String(getUrl()) });
      }
    }

    return {
      evaluate,
      isActive: () => activeVideoId !== null,
      start,
      stop,
    };
  }

  globalThis.TimestampPlayerWatchRoute = {
    createWatchRouteController,
    getWatchVideoId,
  };
})();
