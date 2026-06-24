(() => {
  const TRACKLIST_ANCHOR_SECONDS = 120;
  const TITLE_LOOKAHEAD_LINE_LIMIT = 4;
  const TIMESTAMP_PATTERN = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;

  function findTracks(duration, candidates, minTrackCount = 2) {
    if (candidates.length < minTrackCount || !Number.isFinite(duration) || duration <= 0) {
      return [];
    }

    const bestRun = pickBestIncreasingCandidateRun(getFirstCandidatePerLine(candidates));
    if (bestRun.length < minTrackCount) {
      return [];
    }

    return bestRun.map((candidate, index) => {
      const next = bestRun[index + 1];
      return {
        index,
        start: candidate.start,
        end: next ? Math.max(candidate.start, next.start - 0.2) : duration,
        title: candidate.title,
      };
    });
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

    const viableRuns = runs.filter((run) => run.length >= 2);
    const anchoredRuns = viableRuns.filter((run) => run[0].start <= TRACKLIST_ANCHOR_SECONDS);
    if (anchoredRuns.length) {
      return anchoredRuns.sort(compareCandidateRuns)[0];
    }

    if (viableRuns.length === 1 && viableRuns[0].length === candidates.length) {
      return viableRuns[0];
    }

    return [];
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
      const range = timestampRangeFromLine(line);
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
    if (!value) {
      return NaN;
    }

    const compact = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s?)?$/);
    if (compact) {
      const hours = parseFloat(compact[1] || "0");
      const minutes = parseFloat(compact[2] || "0");
      const seconds = parseFloat(compact[3] || "0");
      return hours * 3600 + minutes * 60 + seconds;
    }

    const seconds = parseFloat(value);
    return Number.isFinite(seconds) ? seconds : NaN;
  }

  function parseTimestampText(value) {
    const text = (value || "").trim();
    if (!/^\d{1,2}:\d{2}(?::\d{2})?$/.test(text)) {
      return NaN;
    }

    const parts = text.split(":").map((part) => parseInt(part, 10));
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
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
    const normalizedLine = normalizeTitleText(line);
    const matches = [...normalizedLine.matchAll(TIMESTAMP_PATTERN)].map((match) => {
      return {
        text: match[0],
        index: match.index,
        endIndex: match.index + match[0].length,
        start: parseTimestampText(match[0]),
      };
    });

    for (let index = 0; index < matches.length - 1; index += 1) {
      const startMatch = matches[index];
      const endMatch = matches[index + 1];
      if (timestampText && timestampText !== startMatch.text && timestampText !== endMatch.text) {
        continue;
      }
      if (!Number.isFinite(startMatch.start) || !Number.isFinite(endMatch.start)) {
        continue;
      }
      if (endMatch.start <= startMatch.start) {
        continue;
      }

      const separator = normalizedLine.slice(startMatch.endIndex, endMatch.index);
      if (!isTimestampRangeSeparator(separator)) {
        continue;
      }

      return {
        normalizedLine,
        start: startMatch.start,
        startTimestampText: startMatch.text,
        end: endMatch.start,
        endTimestampText: endMatch.text,
        title: titleFromRangeFragments(normalizedLine, startMatch, endMatch),
      };
    }

    return null;
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

    const patternLooksBlockBased = hasBlockTitlePattern(candidates, nextLineTitles);
    return candidates.map((candidate) => {
      const nearbyTitle = nextLineTitles.get(candidate);
      if (!nearbyTitle) {
        return candidate;
      }

      if (isWeakTrackTitle(candidate.title) || patternLooksBlockBased) {
        return { ...candidate, title: nearbyTitle };
      }

      return candidate;
    });
  }

  function hasBlockTitlePattern(candidates, nextLineTitles) {
    const lineCandidates = candidates.filter((candidate) => Number.isInteger(candidate.lineIndex));
    if (lineCandidates.length < 2) {
      return false;
    }

    const candidatesWithNearbyTitles = lineCandidates.filter((candidate) => nextLineTitles.has(candidate));
    const weakTitleCandidates = lineCandidates.filter((candidate) => isWeakTrackTitle(candidate.title));
    return candidatesWithNearbyTitles.length >= 2 && weakTitleCandidates.length / lineCandidates.length >= 0.6;
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
      .replace(/^[\s()[\]{}#]+/g, "")
      .replace(/[\s()[\]{}.:：\-–—]+$/g, "");

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
