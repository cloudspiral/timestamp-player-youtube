(() => {
  const TRACK_SOURCE_KINDS = Object.freeze({
    DESCRIPTION: "description",
    COMMENT: "comment",
    NATIVE: "native",
  });
  const TRACK_SOURCE_STATUSES = Object.freeze({
    PROVISIONAL: "provisional",
    SETTLED: "settled",
  });
  const TRACK_SOURCE_TIERS = Object.freeze({
    [TRACK_SOURCE_KINDS.DESCRIPTION]: 300,
    [TRACK_SOURCE_KINDS.COMMENT]: 200,
    [TRACK_SOURCE_KINDS.NATIVE]: 100,
  });
  const OWNERSHIP_CONFIDENCE = Object.freeze({
    STRONG: "strong",
    WEAK: "weak",
  });
  const MINIMUM_WEAK_OWNERSHIP_OBSERVATIONS = 2;

  function createTrackSelectionState() {
    return {
      current: null,
      observation: 0,
      resultsBySourceId: new Map(),
      weakOwnershipObservations: new Map(),
    };
  }

  function beginTrackSelectionObservation(selection) {
    selection.observation += 1;
    return selection.observation;
  }

  function classifyTrackSourceOwnership({
    linkedVideoIds = [],
    shellVideoId = "",
    videoId,
  }) {
    const explicitVideoIds = linkedVideoIds.filter(Boolean);
    if (explicitVideoIds.some((linkedVideoId) => linkedVideoId !== videoId)) {
      return null;
    }
    if (explicitVideoIds.length > 0) {
      return {
        confidence: OWNERSHIP_CONFIDENCE.STRONG,
        evidence: "timestamp-link",
      };
    }
    if (shellVideoId === videoId) {
      return {
        confidence: OWNERSHIP_CONFIDENCE.WEAK,
        evidence: "watch-shell",
      };
    }
    return null;
  }

  function classifyNativeTrackSourceOwnership(candidates, videoId) {
    if (!Array.isArray(candidates) || candidates.length === 0 || !videoId) {
      return null;
    }

    if (candidates.some((candidate) => {
      return candidate.linkedVideoId && candidate.linkedVideoId !== videoId;
    })) {
      return null;
    }

    if (candidates.every((candidate) => candidate.linkedVideoId === videoId)) {
      return {
        confidence: OWNERSHIP_CONFIDENCE.STRONG,
        evidence: "timestamp-link",
      };
    }

    const allCandidatesBelongToCurrentShell = candidates.every((candidate) => {
      return candidate.linkedVideoId === videoId
        || (!candidate.linkedVideoId && candidate.shellVideoId === videoId);
    });
    return allCandidatesBelongToCurrentShell
      ? {
        confidence: OWNERSHIP_CONFIDENCE.WEAK,
        evidence: "watch-shell",
      }
      : null;
  }

  function createTrackSourceResult({
    channel,
    generation,
    kind,
    observation = 0,
    ownership = {},
    sourceId,
    sourceScore = 0,
    status = TRACK_SOURCE_STATUSES.PROVISIONAL,
    tracks = [],
    videoId,
    duration = 0,
  }) {
    if (!Object.hasOwn(TRACK_SOURCE_TIERS, kind)) {
      throw new TypeError(`Unsupported track source kind: ${kind}`);
    }
    if (!videoId || !Number.isInteger(generation) || generation < 1 || !sourceId) {
      throw new TypeError("Track source results require a videoId, generation, and sourceId");
    }

    const source = Object.freeze({
      channel: channel || kind,
      id: String(sourceId),
      kind,
      tier: TRACK_SOURCE_TIERS[kind],
    });
    const normalizedTracks = tracks.map((track, index) => {
      const title = String(track?.title || "").trim();
      return {
        ...track,
        index,
        title,
        titleSource: title ? track.titleSource || source : null,
      };
    });
    const confidence = ownership.confidence || null;

    return withTracks({
      generation,
      observation,
      ownership: {
        confidence,
        confirmed: ownership.confirmed === true || confidence === OWNERSHIP_CONFIDENCE.STRONG,
        evidence: ownership.evidence || "",
      },
      source,
      sourceScore: Number.isFinite(sourceScore) ? sourceScore : 0,
      status: status === TRACK_SOURCE_STATUSES.SETTLED
        ? TRACK_SOURCE_STATUSES.SETTLED
        : TRACK_SOURCE_STATUSES.PROVISIONAL,
      tracks: normalizedTracks,
      videoId,
      duration,
    }, normalizedTracks);
  }

  function observeTrackSourceOwnership(selection, result, {
    minimumWeakObservations = MINIMUM_WEAK_OWNERSHIP_OBSERVATIONS,
  } = {}) {
    if (result.ownership.confidence === OWNERSHIP_CONFIDENCE.STRONG) {
      return setOwnershipConfirmed(result, true);
    }
    if (result.ownership.confidence !== OWNERSHIP_CONFIDENCE.WEAK) {
      return null;
    }

    const sourceKey = getTrackSourceKey(result);
    const signature = trackSourceSignature(result);
    const observation = result.observation || selection.observation;
    const previous = selection.weakOwnershipObservations.get(sourceKey);
    let count = 1;
    if (previous?.signature === signature) {
      if (previous.observation === observation) {
        count = previous.count;
      } else if (previous.observation === observation - 1) {
        count = previous.count + 1;
      }
    }

    selection.weakOwnershipObservations.set(sourceKey, {
      count,
      observation,
      signature,
    });
    return count >= minimumWeakObservations ? setOwnershipConfirmed(result, true) : null;
  }

  function considerTrackSource(selection, candidate, expectedOwner) {
    if (!isTrackSourceEligible(candidate, expectedOwner)) {
      return unchangedSelection(selection.current, "ineligible");
    }

    const sourceKey = getTrackSourceKey(candidate);
    selection.resultsBySourceId.set(sourceKey, candidate);
    const previous = selection.current;
    if (!previous) {
      selection.current = candidate;
      return describeSelectionChange(null, candidate, true);
    }

    const timingWinner = chooseTimingSource(previous, candidate);
    const titleDonor = timingWinner === previous ? candidate : previous;
    let next = mergeTrackSourceTitles(timingWinner, titleDonor);
    next = advanceMatchingSourceMetadata(next, previous, candidate);

    const change = describeSelectionChange(previous, next, timingWinner !== previous);
    if (change.changed) {
      selection.current = next;
    }
    return change;
  }

  function enrichTrackSourceFromCache(liveResult, cachedResult) {
    if (
      !cachedResult
      || liveResult.videoId !== cachedResult.videoId
      || !sameTrackStarts(liveResult.tracks, cachedResult.tracks)
    ) {
      return liveResult;
    }

    return mergeTrackSourceTitles(liveResult, cachedResult);
  }

  function createTrackTitleCacheEntry(result) {
    if (!result?.videoId || !result?.source || !Array.isArray(result.tracks)) {
      throw new TypeError("A track source result is required for title caching");
    }

    const tracks = result.tracks.map((track) => Object.freeze({
      start: track.start,
      title: String(track.title || ""),
      titleSource: track.titleSource || null,
    }));
    return Object.freeze({
      source: result.source,
      tracks: Object.freeze(tracks),
      videoId: result.videoId,
    });
  }

  function isTrackSourceEligible(result, { generation, videoId } = {}) {
    return Boolean(
      result
      && result.generation === generation
      && result.videoId === videoId
      && result.ownership?.confirmed === true
      && hasValidTrackTimings(result.tracks)
    );
  }

  function shouldConsiderNativeSource(selection) {
    return !selection.current
      || selection.current.source.kind === TRACK_SOURCE_KINDS.NATIVE
      || trackSourceNeedsTitleEnrichment(selection.current);
  }

  function trackSourceNeedsTitleEnrichment(result) {
    return Boolean(
      result
      && result.quality.titleScore < result.quality.trackCount * 100
    );
  }

  function hasValidTrackTimings(tracks) {
    if (!Array.isArray(tracks) || tracks.length < 2) {
      return false;
    }

    return tracks.every((track, index) => {
      if (!Number.isFinite(track?.start) || !Number.isFinite(track?.end) || track.start < 0 || track.end <= track.start) {
        return false;
      }
      return index === 0 || track.start > tracks[index - 1].start;
    });
  }

  function chooseTimingSource(incumbent, candidate) {
    if (candidate.source.tier !== incumbent.source.tier) {
      return candidate.source.tier > incumbent.source.tier ? candidate : incumbent;
    }

    const sameSource = getTrackSourceKey(candidate) === getTrackSourceKey(incumbent);
    if (
      candidate.source.kind === TRACK_SOURCE_KINDS.COMMENT
      && !sameSource
      && candidate.sourceScore !== incumbent.sourceScore
    ) {
      return candidate.sourceScore > incumbent.sourceScore ? candidate : incumbent;
    }

    if (isProperStartPrefix(incumbent.tracks, candidate.tracks)) {
      return candidate;
    }
    if (isProperStartPrefix(candidate.tracks, incumbent.tracks)) {
      return incumbent;
    }

    if (candidate.source.kind === TRACK_SOURCE_KINDS.COMMENT && candidate.sourceScore !== incumbent.sourceScore) {
      return candidate.sourceScore > incumbent.sourceScore ? candidate : incumbent;
    }
    if (candidate.quality.trackCount !== incumbent.quality.trackCount) {
      return candidate.quality.trackCount > incumbent.quality.trackCount ? candidate : incumbent;
    }
    if (candidate.quality.titleScore !== incumbent.quality.titleScore) {
      return candidate.quality.titleScore > incumbent.quality.titleScore ? candidate : incumbent;
    }
    if (candidate.quality.coverage !== incumbent.quality.coverage) {
      return candidate.quality.coverage > incumbent.quality.coverage ? candidate : incumbent;
    }
    if (candidate.quality.firstStart !== incumbent.quality.firstStart) {
      return candidate.quality.firstStart < incumbent.quality.firstStart ? candidate : incumbent;
    }

    // An exact quality tie is deliberately stable: later scans and DOM reorderings
    // must not churn the selected source.
    return incumbent;
  }

  function mergeTrackSourceTitles(primary, secondary) {
    if (!primary || !secondary) {
      return primary;
    }

    const secondaryTracksByStart = new Map(secondary.tracks.map((track) => [track.start, track]));
    let changed = false;
    const tracks = primary.tracks.map((track) => {
      const alternate = secondaryTracksByStart.get(track.start);
      if (!alternate || titleQuality(alternate.title) <= titleQuality(track.title)) {
        return track;
      }

      changed = true;
      return {
        ...track,
        title: alternate.title,
        titleSource: alternate.titleSource || secondary.source,
      };
    });
    return changed ? withTracks(primary, tracks) : primary;
  }

  function advanceMatchingSourceMetadata(result, previous, candidate) {
    const sameSource = getTrackSourceKey(previous) === getTrackSourceKey(candidate);
    if (!sameSource) {
      return result;
    }

    const settled = previous.status === TRACK_SOURCE_STATUSES.SETTLED
      || candidate.status === TRACK_SOURCE_STATUSES.SETTLED;
    const confirmed = previous.ownership.confirmed || candidate.ownership.confirmed;
    if (
      (settled ? TRACK_SOURCE_STATUSES.SETTLED : TRACK_SOURCE_STATUSES.PROVISIONAL) === result.status
      && confirmed === result.ownership.confirmed
    ) {
      return result;
    }

    return {
      ...result,
      ownership: {
        ...result.ownership,
        confirmed,
      },
      status: settled ? TRACK_SOURCE_STATUSES.SETTLED : TRACK_SOURCE_STATUSES.PROVISIONAL,
    };
  }

  function describeSelectionChange(previous, next, sourceReplaced) {
    const timingsChanged = !previous || !sameTrackTimings(previous.tracks, next.tracks);
    const titlesChanged = !previous || !sameTrackTitles(previous.tracks, next.tracks);
    const metadataChanged = !previous
      || sourceReplaced
      || previous.status !== next.status
      || previous.ownership.confirmed !== next.ownership.confirmed;

    return {
      accepted: true,
      changed: timingsChanged || titlesChanged || metadataChanged,
      current: next,
      metadataChanged,
      sourceReplaced,
      timingsChanged,
      titlesChanged,
    };
  }

  function unchangedSelection(current, reason) {
    return {
      accepted: false,
      changed: false,
      current,
      metadataChanged: false,
      reason,
      sourceReplaced: false,
      timingsChanged: false,
      titlesChanged: false,
    };
  }

  function withTracks(result, tracks) {
    const duration = Number.isFinite(result.duration) && result.duration > 0 ? result.duration : 0;
    const firstStart = tracks[0]?.start ?? Number.POSITIVE_INFINITY;
    const lastStart = tracks[tracks.length - 1]?.start ?? firstStart;
    const coverage = duration > 0 ? Math.max(0, lastStart - firstStart) / duration : 0;

    return {
      ...result,
      tracks,
      quality: {
        coverage,
        firstStart,
        titleScore: tracks.reduce((score, track) => score + titleQuality(track.title), 0),
        titledCount: tracks.filter((track) => titleQuality(track.title) > 0).length,
        trackCount: tracks.length,
      },
    };
  }

  function setOwnershipConfirmed(result, confirmed) {
    if (result.ownership.confirmed === confirmed) {
      return result;
    }
    return {
      ...result,
      ownership: {
        ...result.ownership,
        confirmed,
      },
    };
  }

  function getTrackSourceKey(result) {
    return `${result.source.kind}:${result.source.channel}:${result.source.id}`;
  }

  function trackSourceSignature(result) {
    return result.tracks.map((track) => `${track.start}:${track.title || ""}`).join("|");
  }

  function sameTrackStarts(left, right) {
    return left.length === right.length
      && left.every((track, index) => track.start === right[index]?.start);
  }

  function isProperStartPrefix(prefix, full) {
    return prefix.length < full.length
      && prefix.every((track, index) => track.start === full[index]?.start);
  }

  function sameTrackTimings(left, right) {
    return left.length === right.length
      && left.every((track, index) => {
        return track.start === right[index]?.start && track.end === right[index]?.end;
      });
  }

  function sameTrackTitles(left, right) {
    return left.length === right.length
      && left.every((track, index) => track.title === right[index]?.title);
  }

  function titleQuality(title) {
    const text = String(title || "").trim();
    if (!text) {
      return 0;
    }

    let score = 100;
    if (/(?:\.{3}|…)$/.test(text)) {
      score -= 18;
    }
    if (/[\/／]/.test(text)) {
      score -= 25;
    }
    if (text.length > 80) {
      score -= Math.min(35, Math.ceil((text.length - 80) / 5));
    }
    return Math.max(1, score);
  }

  globalThis.TimestampPlayerTrackSelection = {
    MINIMUM_WEAK_OWNERSHIP_OBSERVATIONS,
    OWNERSHIP_CONFIDENCE,
    TRACK_SOURCE_KINDS,
    TRACK_SOURCE_STATUSES,
    TRACK_SOURCE_TIERS,
    beginTrackSelectionObservation,
    classifyNativeTrackSourceOwnership,
    classifyTrackSourceOwnership,
    considerTrackSource,
    createTrackSelectionState,
    createTrackSourceResult,
    createTrackTitleCacheEntry,
    enrichTrackSourceFromCache,
    getTrackSourceKey,
    isTrackSourceEligible,
    observeTrackSourceOwnership,
    sameTrackStarts,
    shouldConsiderNativeSource,
    trackSourceNeedsTitleEnrichment,
    titleQuality,
  };
})();
