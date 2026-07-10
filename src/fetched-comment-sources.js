(() => {
  const MINIMUM_COMMENT_TRACKS = 3;
  const MAX_FETCHED_COMMENT_SEEDS = 100;
  const MAX_FETCHED_COMMENT_CANDIDATES = 200;
  const MAX_FETCHED_COMMENT_VARIANTS = 2;
  const MAX_FETCHED_SOURCE_ID_LENGTH = 128;
  const MAX_FETCHED_TITLE_LENGTH = 300;
  const {
    COMMENT_SOURCE_TYPES,
    scoreCommentTrackSource,
  } = globalThis.TimestampPlayerCommentScoring;
  const {
    findTracks,
    getTextTimestampCandidates,
    trackTitleQuality,
  } = globalThis.TimestampPlayerTimestamps;
  const {
    OWNERSHIP_CONFIDENCE,
    TRACK_SOURCE_KINDS,
    createTrackSourceResult,
  } = globalThis.TimestampPlayerTrackSelection;
  const SOURCE_TYPE_RANKS = Object.freeze({
    [COMMENT_SOURCE_TYPES.REGULAR]: 0,
    [COMMENT_SOURCE_TYPES.UPLOADER]: 1,
    [COMMENT_SOURCE_TYPES.PINNED]: 2,
  });

  function createFetchedCommentSeeds(records = []) {
    const seeds = [];
    for (const [recordIndex, record] of records.entries()) {
      if (seeds.length >= MAX_FETCHED_COMMENT_SEEDS) {
        break;
      }

      const parsedCandidates = getFirstCandidatePerLine(
        getTextTimestampCandidates(record?.text, `fetched-comment:${recordIndex}`)
      ).slice(0, MAX_FETCHED_COMMENT_CANDIDATES);
      const sourceId = getFetchedCommentSourceId(record, parsedCandidates, recordIndex);
      const candidates = parsedCandidates
        .map((candidate, candidateIndex) => compactCandidate(candidate, candidateIndex));
      if (candidates.length < MINIMUM_COMMENT_TRACKS) {
        continue;
      }

      seeds.push(Object.freeze({
        candidateVariants: Object.freeze([Object.freeze(candidates)]),
        likeCount: Number.isFinite(record?.likeCount) && record.likeCount >= 0
          ? record.likeCount
          : null,
        order: Number.isInteger(record?.order) && record.order >= 0
          ? record.order
          : recordIndex,
        sourceId,
        sourceType: getFetchedCommentSourceType(record),
      }));
    }
    return Object.freeze(seeds);
  }

  function mergeFetchedCommentSeeds(previousSeeds = [], incomingSeeds = []) {
    const merged = [...previousSeeds].slice(0, MAX_FETCHED_COMMENT_SEEDS);
    const indexBySourceId = new Map(
      merged.map((seed, index) => [seed.sourceId, index])
    );

    for (const incoming of incomingSeeds) {
      const existingIndex = indexBySourceId.get(incoming.sourceId);
      if (existingIndex !== undefined) {
        merged[existingIndex] = mergeMatchingSeed(merged[existingIndex], incoming);
        continue;
      }
      if (merged.length >= MAX_FETCHED_COMMENT_SEEDS) {
        break;
      }
      indexBySourceId.set(incoming.sourceId, merged.length);
      merged.push(incoming);
    }
    return Object.freeze(merged);
  }

  function selectFetchedCommentSource({
    duration,
    generation,
    observation = 0,
    seeds = [],
    status,
    videoId,
  } = {}) {
    let best = null;
    for (const seed of seeds) {
      for (const candidates of seed.candidateVariants || []) {
        const tracks = findTracks(duration, candidates, MINIMUM_COMMENT_TRACKS);
        if (tracks.length < MINIMUM_COMMENT_TRACKS) {
          continue;
        }

        const sourceScore = scoreCommentTrackSource({
          duration,
          likeCount: seed.likeCount,
          order: seed.order,
          sourceType: seed.sourceType,
          tracks,
        });
        const result = createTrackSourceResult({
          channel: "comment-api",
          duration,
          generation,
          kind: TRACK_SOURCE_KINDS.COMMENT,
          observation,
          ownership: {
            confidence: OWNERSHIP_CONFIDENCE.STRONG,
            evidence: "network-request",
          },
          sourceId: seed.sourceId,
          sourceScore,
          status,
          tracks,
          videoId,
        });
        if (!best || result.sourceScore > best.sourceScore) {
          best = result;
        }
      }
    }
    return best;
  }

  function compactCandidate(candidate, fallbackIndex) {
    const lineIndex = Number.isInteger(candidate?.lineIndex)
      ? candidate.lineIndex
      : fallbackIndex;
    return Object.freeze({
      lineKey: String(lineIndex),
      start: candidate.start,
      title: String(candidate.title || "").slice(0, MAX_FETCHED_TITLE_LENGTH),
    });
  }

  function getFetchedCommentSourceId(record, candidates, fallbackIndex) {
    const commentId = typeof record?.commentId === "string"
      ? record.commentId.trim().slice(0, MAX_FETCHED_SOURCE_ID_LENGTH)
      : "";
    if (commentId) {
      return commentId;
    }

    const order = Number.isInteger(record?.order) && record.order >= 0
      ? record.order
      : fallbackIndex;
    const candidateSignature = candidates.length
      ? candidates.map(({ start, title }) => `${start}:${title || ""}`).join("|")
      : "empty";
    return `anonymous-${hashString(`${order}|${candidateSignature}`)}`;
  }

  function getFirstCandidatePerLine(candidates) {
    const firstCandidates = [];
    const seenLines = new Set();
    for (const [index, candidate] of candidates.entries()) {
      const lineKey = Number.isInteger(candidate?.lineIndex)
        ? `line:${candidate.lineIndex}`
        : `candidate:${candidate?.lineKey || index}`;
      if (seenLines.has(lineKey)) {
        continue;
      }
      seenLines.add(lineKey);
      firstCandidates.push(candidate);
    }
    return firstCandidates;
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function getFetchedCommentSourceType(record) {
    if (record?.isPinned) {
      return COMMENT_SOURCE_TYPES.PINNED;
    }
    if (record?.isUploader) {
      return COMMENT_SOURCE_TYPES.UPLOADER;
    }
    return COMMENT_SOURCE_TYPES.REGULAR;
  }

  function mergeMatchingSeed(previous, incoming) {
    const previousSourceRank = SOURCE_TYPE_RANKS[previous.sourceType] || 0;
    const incomingSourceRank = SOURCE_TYPE_RANKS[incoming.sourceType] || 0;
    return Object.freeze({
      candidateVariants: mergeCandidateVariants(
        previous.candidateVariants,
        incoming.candidateVariants
      ),
      likeCount: maximumFinite(previous.likeCount, incoming.likeCount),
      order: Math.min(previous.order, incoming.order),
      sourceId: previous.sourceId,
      sourceType: incomingSourceRank > previousSourceRank
        ? incoming.sourceType
        : previous.sourceType,
    });
  }

  function mergeCandidateVariants(previousVariants = [], incomingVariants = []) {
    // A retry can expose more timestamp-shaped text while producing a worse
    // increasing run. Keep a tiny set of independent variants so duration-time
    // normalization chooses the usable source instead of flattening them.
    const variants = [...previousVariants];
    for (const incoming of incomingVariants) {
      const matchingIndex = variants.findIndex((candidateSet) => {
        return sameCandidateStarts(candidateSet, incoming);
      });
      if (matchingIndex >= 0) {
        variants[matchingIndex] = enrichCandidateTitles(variants[matchingIndex], incoming);
      } else if (variants.length < MAX_FETCHED_COMMENT_VARIANTS) {
        variants.push(incoming);
      }
    }
    return Object.freeze(variants.slice(0, MAX_FETCHED_COMMENT_VARIANTS));
  }

  function enrichCandidateTitles(previous, incoming) {
    let changed = false;
    const candidates = previous.map((candidate, index) => {
      const alternate = incoming[index];
      if (trackTitleQuality(candidate.title) >= trackTitleQuality(alternate?.title)) {
        return candidate;
      }
      changed = true;
      return Object.freeze({ ...candidate, title: alternate.title });
    });
    return changed ? Object.freeze(candidates) : previous;
  }

  function sameCandidateStarts(left, right) {
    return left.length === right.length
      && left.every((candidate, index) => candidate.start === right[index]?.start);
  }

  function maximumFinite(left, right) {
    const values = [left, right].filter(Number.isFinite);
    return values.length ? Math.max(...values) : null;
  }

  globalThis.TimestampPlayerFetchedCommentSources = {
    MAX_FETCHED_COMMENT_CANDIDATES,
    MAX_FETCHED_COMMENT_SEEDS,
    MAX_FETCHED_COMMENT_VARIANTS,
    MAX_FETCHED_SOURCE_ID_LENGTH,
    MAX_FETCHED_TITLE_LENGTH,
    createFetchedCommentSeeds,
    mergeFetchedCommentSeeds,
    selectFetchedCommentSource,
  };
})();
