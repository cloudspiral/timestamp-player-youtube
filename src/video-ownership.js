(() => {
  function getWatchShellVideoId(watchShell) {
    return firstNonEmptyString([
      watchShell?.getAttribute?.("video-id"),
      watchShell?.videoId,
    ]);
  }

  function getMusicPlayerVideoId(playerPage) {
    return firstNonEmptyString([
      playerPage?.getAttribute?.("video-id"),
      playerPage?.getAttribute?.("data-video-id"),
      playerPage?.videoId,
      playerPage?.data?.videoId,
      playerPage?.data?.watchEndpoint?.videoId,
    ]);
  }

  function firstNonEmptyString(candidates) {
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
    return "";
  }

  globalThis.TimestampPlayerVideoOwnership = {
    getMusicPlayerVideoId,
    getWatchShellVideoId,
  };
})();
