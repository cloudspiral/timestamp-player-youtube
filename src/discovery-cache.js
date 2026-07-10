(() => {
  const TRACK_TITLE_CACHE_MAX_ENTRIES = 20;
  const TRACK_TITLE_CACHE_TTL_MS = 2 * 60 * 60 * 1000;

  const {
    createLruCache,
  } = globalThis.TimestampPlayerLruCache;
  const {
    TRACK_SOURCE_STATUSES,
    createTrackTitleCacheEntry,
    enrichTrackSourceFromCache,
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

  function retainFetchedCommentResult(
    previous,
    incoming,
    status = TRACK_SOURCE_STATUSES.PROVISIONAL
  ) {
    if (!previous && !incoming) {
      return null;
    }

    let winner = previous || incoming;
    let donor = null;
    if (previous && incoming) {
      const incomingWins = compareFetchedCommentResults(incoming, previous) > 0;
      winner = incomingWins ? incoming : previous;
      donor = incomingWins ? previous : incoming;
      winner = enrichTrackSourceFromCache(winner, donor);
    }

    const settled = status === TRACK_SOURCE_STATUSES.SETTLED
      || previous?.status === TRACK_SOURCE_STATUSES.SETTLED
      || incoming?.status === TRACK_SOURCE_STATUSES.SETTLED;
    const nextStatus = settled
      ? TRACK_SOURCE_STATUSES.SETTLED
      : TRACK_SOURCE_STATUSES.PROVISIONAL;
    return winner.status === nextStatus ? winner : { ...winner, status: nextStatus };
  }

  function compareFetchedCommentResults(left, right) {
    if (left.sourceScore !== right.sourceScore) {
      return left.sourceScore - right.sourceScore;
    }

    const sameSource = left.source?.kind === right.source?.kind
      && left.source?.channel === right.source?.channel
      && left.source?.id === right.source?.id;
    if (!sameSource) {
      return 0;
    }

    for (const field of ["trackCount", "titleScore", "coverage"]) {
      const difference = Number(left.quality?.[field] || 0) - Number(right.quality?.[field] || 0);
      if (difference !== 0) {
        return difference;
      }
    }
    return 0;
  }

  globalThis.TimestampPlayerDiscoveryCache = {
    TRACK_TITLE_CACHE_MAX_ENTRIES,
    TRACK_TITLE_CACHE_TTL_MS,
    createTrackTitleCache,
    retainFetchedCommentResult,
    storeSettledTrackTitles,
  };
})();
