(() => {
  const TRACK_TITLE_CACHE_MAX_ENTRIES = 20;
  const TRACK_TITLE_CACHE_TTL_MS = 2 * 60 * 60 * 1000;

  const {
    createLruCache,
  } = globalThis.TimestampPlayerLruCache;
  const {
    TRACK_SOURCE_STATUSES,
    createTrackTitleCacheEntry,
  } = globalThis.TimestampPlayerTrackSelection;

  function createTrackTitleCache({
    maxEntries = TRACK_TITLE_CACHE_MAX_ENTRIES,
    now,
    ttlMs = TRACK_TITLE_CACHE_TTL_MS,
  } = {}) {
    return createLruCache({ maxEntries, now, ttlMs });
  }

  function storeSettledTrackTitles(cache, result) {
    if (
      !cache
      || result?.status !== TRACK_SOURCE_STATUSES.SETTLED
      || !result.videoId
      || !Array.isArray(result.tracks)
      || result.tracks.length < 2
    ) {
      return false;
    }

    cache.set(result.videoId, createTrackTitleCacheEntry(result));
    return true;
  }

  globalThis.TimestampPlayerDiscoveryCache = {
    TRACK_TITLE_CACHE_MAX_ENTRIES,
    TRACK_TITLE_CACHE_TTL_MS,
    createTrackTitleCache,
    storeSettledTrackTitles,
  };
})();
