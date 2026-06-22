(() => {
  const SOURCE_TRUST_SCORES = {
    pinned: 20,
    uploader: 14,
    regular: 0,
  };

  const START_SCORES = [
    { maximumStart: 30, score: 35 },
    { maximumStart: 120, score: 25 },
    { maximumStart: 300, score: 10 },
  ];
  const VIDEO_COVERAGE_MAX_SCORE = 45;
  const LIKE_COUNT_MAX_SCORE = 30;
  const LIKE_COUNT_LOG_MULTIPLIER = 9;
  const TITLE_COVERAGE_MAX_SCORE = 10;
  const TRACK_COUNT_SCORE_PER_TRACK = 0.4;
  const TRACK_COUNT_SCORE_CAP = 40;

  // Score how much a comment source looks like a real full-video tracklist.
  // Coverage and early start matter most; likes are a strong supporting signal;
  // raw timestamp count is intentionally weak so dense non-track comments do not dominate.
  function scoreCommentTrackSource(source) {
    const tracks = source.tracks || [];
    if (!tracks.length || !Number.isFinite(source.duration) || source.duration <= 0) {
      return Number.NEGATIVE_INFINITY;
    }

    const firstStart = tracks[0].start;
    const lastStart = tracks[tracks.length - 1].start;
    const timestampSpan = Math.max(0, lastStart - firstStart);
    const coverageRatio = clamp(timestampSpan / source.duration, 0, 1);
    const titledTrackRatio = tracks.filter((track) => (track.title || "").trim()).length / tracks.length;
    const likeScore = Number.isFinite(source.likeCount)
      ? Math.min(LIKE_COUNT_MAX_SCORE, Math.log10(source.likeCount + 1) * LIKE_COUNT_LOG_MULTIPLIER)
      : 0;

    return sourceTrustScore(source.sourceType)
      + startScore(firstStart)
      + VIDEO_COVERAGE_MAX_SCORE * coverageRatio
      + likeScore
      + TITLE_COVERAGE_MAX_SCORE * titledTrackRatio
      + TRACK_COUNT_SCORE_PER_TRACK * Math.min(tracks.length, TRACK_COUNT_SCORE_CAP);
  }

  function compareCommentTrackSources(left, right) {
    const scoreDifference = scoreCommentTrackSource(right) - scoreCommentTrackSource(left);
    if (scoreDifference !== 0) {
      return scoreDifference;
    }

    return left.order - right.order;
  }

  function parseCommentLikeCount(text) {
    const normalized = (text || "")
      .replace(/,/g, "")
      .trim();
    const match = normalized.match(/(\d+(?:\.\d+)?)\s*([km])?/i);
    if (!match) {
      return null;
    }

    const value = parseFloat(match[1]);
    if (!Number.isFinite(value)) {
      return null;
    }

    const suffix = (match[2] || "").toLowerCase();
    const multiplier = suffix === "m" ? 1000000 : suffix === "k" ? 1000 : 1;
    return Math.round(value * multiplier);
  }

  function sourceTrustScore(sourceType) {
    return SOURCE_TRUST_SCORES[sourceType] || 0;
  }

  function startScore(firstStart) {
    const match = START_SCORES.find(({ maximumStart }) => firstStart <= maximumStart);
    return match ? match.score : 0;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  globalThis.TimestampPlayerCommentScoring = {
    compareCommentTrackSources,
    parseCommentLikeCount,
    scoreCommentTrackSource,
  };
})();
