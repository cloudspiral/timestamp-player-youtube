(() => {
  const TRACKLIST_ANCHOR_SECONDS = 120;
  const TRACK_BOUNDARY_GAP_SECONDS = 0.2;
  const TIMESTAMP_EPSILON_SECONDS = 0.000001;
  const TITLE_LOOKAHEAD_LINE_LIMIT = 4;
  const TIMESTAMP_PATTERN = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;
  const TRACK_NUMBER_DECORATION_EDGE_PATTERN = /^[\s()[\]{}#"']+|[\s()[\]{}#"'.,:：\-–—]+$/g;

  function findTracks(duration, candidates, minTrackCount = 2) {
    if (candidates.length < minTrackCount || !Number.isFinite(duration) || duration <= 0) {
      return [];
    }

    const validCandidates = candidates
      .map((candidate) => normalizeCandidateStart(candidate, duration))
      .filter(Boolean);
    if (validCandidates.length < minTrackCount) {
      return [];
    }

    const bestRun = pickBestIncreasingCandidateRun(getFirstCandidatePerLine(validCandidates));
    if (bestRun.length < minTrackCount) {
      return [];
    }

    const tracks = bestRun.map((candidate, index) => {
      const next = bestRun[index + 1];
      return {
        index,
        start: candidate.start,
        end: next ? Math.min(duration, next.start - TRACK_BOUNDARY_GAP_SECONDS) : duration,
        title: candidate.title,
      };
    });

    return tracks.every((track) => isValidTrackInterval(track, duration)) ? tracks : [];
  }

  function normalizeCandidateStart(candidate, duration) {
    if (!candidate || !Number.isFinite(candidate.start)) {
      return null;
    }

    let start = candidate.start;
    if (start < 0 && start >= -TIMESTAMP_EPSILON_SECONDS) {
      start = 0;
    }
    if (Object.is(start, -0)) {
      start = 0;
    }
    if (start < 0 || start >= duration - TIMESTAMP_EPSILON_SECONDS) {
      return null;
    }

    return Object.is(start, candidate.start) ? candidate : { ...candidate, start };
  }

  function isValidTrackInterval(track, duration) {
    return Number.isFinite(track.start)
      && Number.isFinite(track.end)
      && track.start >= 0
      && track.start < track.end
      && track.end <= duration;
  }

  function getFirstCandidatePerLine(candidates) {
    const deduped = [];
    const seenLines = new Set();
    const candidateIndexByStart = new Map();
    for (const [sourceOrder, candidate] of candidates.entries()) {
      const lineKey = candidate.lineKey || `${sourceOrder}:${candidate.timestampText}`;
      if (seenLines.has(lineKey)) {
        continue;
      }

      seenLines.add(lineKey);
      const existingIndex = candidateIndexByStart.get(candidate.start);
      if (existingIndex !== undefined) {
        const existingCandidate = deduped[existingIndex];
        if (trackTitleQuality(candidate.title) > trackTitleQuality(existingCandidate.title)) {
          deduped[existingIndex] = { ...candidate, sourceOrder: existingCandidate.sourceOrder };
        }
        continue;
      }

      candidateIndexByStart.set(candidate.start, deduped.length);
      deduped.push({ ...candidate, sourceOrder });
    }

    return deduped;
  }

  function pickBestIncreasingCandidateRun(candidates) {
    const runs = [];
    let currentRun = [];

    for (const candidate of candidates) {
      const previous = currentRun[currentRun.length - 1];
      if (!previous || candidate.start > previous.start) {
        currentRun.push(candidate);
      } else {
        runs.push(currentRun);
        currentRun = [candidate];
      }
    }

    runs.push(currentRun);

    const coalescedRuns = runs.map(coalesceNearDuplicateCandidates);
    const viableRuns = coalescedRuns.filter((run) => run.length >= 2);
    const anchoredRuns = viableRuns.filter((run) => run[0].start <= TRACKLIST_ANCHOR_SECONDS);
    if (anchoredRuns.length) {
      return anchoredRuns.sort(compareCandidateRuns)[0];
    }

    if (viableRuns.length === 1 && runs.length === 1) {
      return viableRuns[0];
    }

    return [];
  }

  function coalesceNearDuplicateCandidates(candidates) {
    const coalesced = [];
    for (const candidate of candidates) {
      const previous = coalesced[coalesced.length - 1];
      if (
        previous
        && candidate.start - previous.start <= TRACK_BOUNDARY_GAP_SECONDS + TIMESTAMP_EPSILON_SECONDS
      ) {
        if (trackTitleQuality(candidate.title) > trackTitleQuality(previous.title)) {
          coalesced[coalesced.length - 1] = { ...previous, title: candidate.title };
        }
        continue;
      }

      coalesced.push(candidate);
    }
    return coalesced;
  }

  function compareCandidateRuns(left, right) {
    if (left.length !== right.length) {
      return right.length - left.length;
    }

    if (left[0].start !== right[0].start) {
      return left[0].start - right[0].start;
    }

    return left[0].sourceOrder - right[0].sourceOrder;
  }

  function getTextTimestampCandidates(text, sourceKey) {
    const candidates = [];
    const lines = (text || "").split(/\r?\n/);
    for (const [lineIndex, line] of lines.entries()) {
      const rangeResult = getTimestampRangeResult(line);
      const { range } = rangeResult;
      if (range) {
        candidates.push({
          start: range.start,
          timestampText: range.startTimestampText,
          title: cleanTrackTitle(range.title),
          lineKey: `${sourceKey}:${lineIndex}:${range.normalizedLine}`,
          lineIndex,
        });
        continue;
      }
      if (rangeResult.invalid) {
        continue;
      }

      for (const match of normalizeTitleText(line).matchAll(TIMESTAMP_PATTERN)) {
        const timestampText = match[0];
        const start = parseTimestampText(timestampText);
        if (!Number.isFinite(start)) {
          continue;
        }

        candidates.push({
          start,
          timestampText,
          title: cleanTrackTitle(titleFromLineFragment(line, timestampText)),
          lineKey: `${sourceKey}:${lineIndex}:${normalizeTitleText(line)}`,
          lineIndex,
        });
      }
    }

    return enrichCandidateTitlesFromNearbyLines(candidates, lines);
  }

  function parseTimeParam(value) {
    if (typeof value !== "string") {
      return NaN;
    }

    const text = value.trim();
    if (!text) {
      return NaN;
    }

    const compact = text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s?)?$/);
    if (!compact || !compact.slice(1).some(Boolean)) {
      return NaN;
    }

    const hours = parseFloat(compact[1] || "0");
    const minutes = parseFloat(compact[2] || "0");
    const seconds = parseFloat(compact[3] || "0");
    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    return Number.isFinite(totalSeconds) ? totalSeconds : NaN;
  }

  function parseTimestampText(value) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!/^\d{1,2}:\d{2}(?::\d{2})?$/.test(text)) {
      return NaN;
    }

    const parts = text.split(":").map((part) => parseInt(part, 10));
    const seconds = parts[parts.length - 1];
    if (seconds >= 60 || (parts.length === 3 && parts[1] >= 60)) {
      return NaN;
    }
    if (parts.length === 2) {
      return parts[0] * 60 + seconds;
    }
    return parts[0] * 3600 + parts[1] * 60 + seconds;
  }

  function lineContainingTimestamp(text, timestamp) {
    const lines = text.split(/\r?\n/);
    return lines.find((entry) => entry.includes(timestamp)) || "";
  }

  function titleFromLineFragment(line, timestamp) {
    const range = timestampRangeFromLine(line, timestamp);
    if (range) {
      return range.title;
    }

    const normalizedLine = normalizeTitleText(line);
    const timestampIndex = normalizedLine.indexOf(timestamp);
    if (timestampIndex === -1) {
      return "";
    }

    const beforeTimestamp = normalizedLine.slice(0, timestampIndex);
    const afterTimestamp = normalizedLine.slice(timestampIndex + timestamp.length);
    const beforeTitle = stripTimestampAdjacency(beforeTimestamp, "before");
    const afterTitle = stripTimestampAdjacency(afterTimestamp, "after");

    if (beforeTitle && afterTitle) {
      return beforeTitle.length >= afterTitle.length ? beforeTitle : afterTitle;
    }

    return beforeTitle || trimAfterEmbeddedTimestamp(afterTitle);
  }

  function isTimestampRangeEndMarker(line, timestamp) {
    const range = timestampRangeFromLine(line, timestamp);
    return Boolean(range && range.endTimestampText === timestamp);
  }

  function timestampRangeFromLine(line, timestampText = "") {
    return getTimestampRangeResult(line, timestampText).range;
  }

  function getTimestampRangeResult(line, timestampText = "") {
    const normalizedLine = normalizeTitleText(line);
    const matches = [...normalizedLine.matchAll(TIMESTAMP_PATTERN)].map((match) => {
      return {
        text: match[0],
        index: match.index,
        endIndex: match.index + match[0].length,
        start: parseTimestampText(match[0]),
      };
    });

    let invalid = false;
    for (let index = 0; index < matches.length - 1; index += 1) {
      const startMatch = matches[index];
      const endMatch = matches[index + 1];
      if (timestampText && timestampText !== startMatch.text && timestampText !== endMatch.text) {
        continue;
      }
      const separator = normalizedLine.slice(startMatch.endIndex, endMatch.index);
      if (!isTimestampRangeSeparator(separator)) {
        continue;
      }

      if (
        !Number.isFinite(startMatch.start)
        || !Number.isFinite(endMatch.start)
        || endMatch.start <= startMatch.start
      ) {
        invalid = true;
        continue;
      }

      return {
        invalid: false,
        range: {
          normalizedLine,
          start: startMatch.start,
          startTimestampText: startMatch.text,
          end: endMatch.start,
          endTimestampText: endMatch.text,
          title: titleFromRangeFragments(normalizedLine, startMatch, endMatch),
        },
      };
    }

    return { invalid, range: null };
  }

  function isTimestampRangeSeparator(text) {
    const cleaned = normalizeTitleText(text)
      .replace(/^[\s()[\]{}]+/g, "")
      .replace(/[\s()[\]{}]+$/g, "");

    return /^[-–—]+$/.test(cleaned) || /^(?:to|until)$/i.test(cleaned);
  }

  function titleFromRangeFragments(line, startMatch, endMatch) {
    const beforeTitle = stripTimestampAdjacency(line.slice(0, startMatch.index), "before");
    const afterTitle = stripTimestampAdjacency(line.slice(endMatch.endIndex), "after");

    if (beforeTitle && afterTitle) {
      return beforeTitle.length >= afterTitle.length ? beforeTitle : afterTitle;
    }

    return beforeTitle || afterTitle;
  }

  function enrichCandidateTitlesFromNearbyLines(candidates, lines) {
    const nextLineTitles = new Map();
    for (const candidate of candidates) {
      if (!Number.isInteger(candidate.lineIndex)) {
        continue;
      }

      const nearbyTitle = findNearbyTitleLine(lines, candidate.lineIndex);
      if (nearbyTitle) {
        nextLineTitles.set(candidate, nearbyTitle);
      }
    }

    return candidates.map((candidate) => {
      const nearbyTitle = nextLineTitles.get(candidate);
      if (!nearbyTitle) {
        return candidate;
      }

      if (isWeakTrackTitle(candidate.title)) {
        return { ...candidate, title: nearbyTitle };
      }

      return candidate;
    });
  }

  function findNearbyTitleLine(lines, timestampLineIndex) {
    let checkedMeaningfulLines = 0;
    for (
      let index = timestampLineIndex + 1;
      index < lines.length && checkedMeaningfulLines < TITLE_LOOKAHEAD_LINE_LIMIT;
      index += 1
    ) {
      const line = normalizeTitleText(lines[index]);
      if (!line) {
        continue;
      }

      checkedMeaningfulLines += 1;
      if (isTitleSearchBoundaryLine(line) || lineHasTimestamp(line)) {
        return "";
      }

      if (isTrackNumberOnlyText(line)) {
        continue;
      }

      if (isMetadataLine(line)) {
        return "";
      }

      const title = cleanTrackTitle(line);
      if (!isWeakTrackTitle(title)) {
        return title;
      }
    }

    return "";
  }

  function isTitleSearchBoundaryLine(line) {
    return /^[-–—_=*]{3,}$/.test(normalizeTitleText(line));
  }

  function lineHasTimestamp(line) {
    return /\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(normalizeTitleText(line));
  }

  function isMetadataLine(line) {
    const text = normalizeTitleText(line);
    return /^(?:album|arrange|arranged|arrangement|arranger|artist|catalog(?:ue)?(?: no)?|circle|composer|genre|length|lyric|lyrics|original(?:\s+(?:arrangement|title))?|released|release date|remix|source|track ?list|timestamps?|vocal|vocals)\b\s*[.:：]/i.test(
      text
    );
  }

  function isWeakTrackTitle(title) {
    return !normalizeTitleText(title) || isTrackNumberOnlyText(title) || isTimestampOnlyText(title);
  }

  function isTrackNumberOnlyText(text) {
    const cleaned = normalizeTitleText(text)
      .replace(TRACK_NUMBER_DECORATION_EDGE_PATTERN, "");

    return /^(?:track\s*)?\d{1,3}$/i.test(cleaned);
  }

  function stripTimestampAdjacency(text, side) {
    let cleaned = normalizeTitleText(text);

    if (side === "before") {
      cleaned = cleaned
        .replace(/[\s([{\-–—:|/]*$/g, "")
        .replace(/\s+\d{1,2}:\d{2}(?::\d{2})?.*$/g, "");
    } else {
      cleaned = cleaned.replace(/^[\s)\]}.,;:\-–—|/]+/g, "");
    }

    return cleaned.trim();
  }

  function cleanTrackTitle(title) {
    const cleaned = normalizeTitleText(title)
      .replace(/\s+\/\s*(?:original|vocal|lyrics|arrange|arrangement|source)\b.*$/i, "")
      .replace(/^[\s()[\]{}#"']*(?:track\s*)?\d{1,3}[\s.)\]:：\-–—]+/i, "")
      .replace(/^\s*(?:track\s*)?\d{1,3}[\s.)\]-]+/i, "")
      .replace(/\s*(?:\.{3}|…)\s*more$/i, "")
      .trim();

    return isTimestampOnlyText(cleaned) || isTrackNumberOnlyText(cleaned) ? "" : cleaned;
  }

  function trackTitleQuality(title) {
    const text = cleanTrackTitle(title);
    if (isWeakTrackTitle(text)) {
      return 0;
    }

    let score = 100;
    if (hasTrailingEllipsis(text)) {
      score -= 18;
    }
    if (/[\/／]/.test(text)) {
      score -= 25;
    }
    if (text.length > 80) {
      score -= Math.min(35, Math.ceil((text.length - 80) / 5));
    }
    return score;
  }

  function hasTrailingEllipsis(text) {
    return /(?:\.{3}|…)$/.test(normalizeTitleText(text));
  }

  function isTimestampOnlyText(text) {
    if (!text) {
      return false;
    }

    return text
      .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, "")
      .replace(/[\s()[\]{}.,;:\-–—|/]+/g, "")
      .trim() === "";
  }

  function normalizeTitleText(text) {
    return (text || "")
      .replace(/\u00a0/g, " ")
      .replace(/\u3000/g, " ")
      .replace(/[ \t]+/g, " ")
      .trim();
  }

  function trimAfterEmbeddedTimestamp(text) {
    return normalizeTitleText(text)
      .replace(/\s+\d{1,2}:\d{2}(?::\d{2})?.*$/, "")
      .trim();
  }

  function formatTrackLabel(track) {
    return track.title || `Track ${track.index + 1}`;
  }

  function formatTimestamp(seconds) {
    const totalSeconds = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const remainingSeconds = totalSeconds % 60;
    const paddedSeconds = String(remainingSeconds).padStart(2, "0");

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
    }

    return `${minutes}:${paddedSeconds}`;
  }

  function trackTitleScore(tracks) {
    return tracks.reduce((score, track) => {
      const title = (track.title || "").trim();
      return score + (title ? 1 : 0);
    }, 0);
  }

  globalThis.TimestampPlayerTimestamps = {
    cleanTrackTitle,
    findTracks,
    formatTimestamp,
    formatTrackLabel,
    getTextTimestampCandidates,
    isTimestampRangeEndMarker,
    lineContainingTimestamp,
    normalizeTitleText,
    parseTimeParam,
    parseTimestampText,
    titleFromLineFragment,
    trackTitleScore,
  };
})();
