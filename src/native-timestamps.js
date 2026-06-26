(() => {
  const NATIVE_TIMESTAMP_CONTAINER_SELECTOR = [
    "ytd-horizontal-card-list-renderer",
    "ytd-macro-markers-list-renderer",
    "ytd-macro-markers-list-item-renderer",
  ].join(",");
  const NATIVE_TIMESTAMP_ITEM_SELECTOR = [
    "ytd-macro-markers-list-item-renderer",
    "ytd-horizontal-card-list-renderer",
    "a[href*='/watch']",
  ].join(",");
  const NATIVE_LABEL_SELECTOR = [
    "#details",
    "#title",
    "#video-title",
    ".title",
    ".yt-core-attributed-string",
    "yt-formatted-string",
    "span",
  ].join(",");
  const UI_LABEL_PATTERN = /^(?:key moments|chapters|view all|show less|all)$/i;
  const {
    cleanTrackTitle,
    normalizeTitleText,
    parseTimeParam,
    parseTimestampText,
  } = globalThis.TimestampPlayerTimestamps;

  function getNativeTimestampCandidates(videoId, root = document) {
    const candidates = [];
    const seen = new Set();

    for (const link of getNativeTimestampLinks(root)) {
      const candidate = toNativeTimestampCandidate(link, videoId);
      if (!candidate) {
        continue;
      }

      const key = `${candidate.start}:${candidate.lineKey}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      candidates.push(candidate);
    }

    return candidates;
  }

  function getNativeTimestampLinks(root) {
    const links = [];
    const seen = new Set();
    for (const container of root.querySelectorAll(NATIVE_TIMESTAMP_CONTAINER_SELECTOR)) {
      for (const link of container.querySelectorAll("a[href*='/watch']")) {
        if (!seen.has(link)) {
          seen.add(link);
          links.push(link);
        }
      }
    }
    return links;
  }

  function toNativeTimestampCandidate(link, videoId) {
    const url = new URL(link.href, location.href);
    const linkedVideoId = url.searchParams.get("v");
    if (linkedVideoId && linkedVideoId !== videoId) {
      return null;
    }

    const timeParamStart = parseTimeParam(url.searchParams.get("t"));
    const timestampText = normalizeTitleText(link.textContent);
    const start = Number.isFinite(timeParamStart) ? timeParamStart : parseTimestampText(timestampText);
    if (!Number.isFinite(start)) {
      return null;
    }

    const item = getNativeTimestampItem(link);
    const rawTitle = getBestNativeLabel(link, item);
    const title = cleanNativeTitle(rawTitle, timestampText);
    const lineKey = normalizeTitleText(item?.textContent || `${timestampText}:${title}`);

    return {
      start,
      timestampText,
      title,
      lineKey,
    };
  }

  function getNativeTimestampItem(link) {
    const closestItem = link.closest(NATIVE_TIMESTAMP_ITEM_SELECTOR);
    if (!closestItem || closestItem === link) {
      return link.parentElement || link;
    }
    return closestItem;
  }

  function getBestNativeLabel(link, item) {
    const labelSources = [
      ...getAttributeLabels(link),
      ...getAttributeLabels(item),
      ...getNearbyTextLabels(link, item),
      getVisibleItemLabel(item),
    ];

    return labelSources
      .map(cleanNativeLabelText)
      .filter(Boolean)
      .sort(compareNativeLabels)[0] || "";
  }

  function getAttributeLabels(element) {
    if (!element) {
      return [];
    }

    return [
      element.getAttribute("title"),
      element.getAttribute("aria-label"),
      element.getAttribute("aria-description"),
    ].filter(Boolean);
  }

  function getNearbyTextLabels(link, item) {
    if (!item) {
      return [];
    }

    const labels = [];
    for (const element of item.querySelectorAll(NATIVE_LABEL_SELECTOR)) {
      if (element === link || element.contains(link) || link.contains(element)) {
        continue;
      }

      const text = element.textContent;
      if (text) {
        labels.push(text);
      }
    }

    return labels;
  }

  function getVisibleItemLabel(item) {
    return item?.innerText || item?.textContent || "";
  }

  function cleanNativeLabelText(text) {
    const normalized = normalizeTitleText(text);
    if (!normalized || isUiLabel(normalized)) {
      return "";
    }

    return normalized
      .split(/\r?\n/)
      .map((line) => normalizeTitleText(line))
      .filter((line) => line && !isUiLabel(line) && !isTimestampOnlyLine(line))
      .join(" ");
  }

  function cleanNativeTitle(text, timestampText) {
    const withoutTimestamp = normalizeTitleText(text)
      .replace(timestampText, "")
      .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, "")
      .replace(/\s*(?:\.{3}|…)\s*more$/i, "")
      .trim();

    const title = cleanTrackTitle(withoutTimestamp);
    return isUiLabel(title) ? "" : title;
  }

  function isUiLabel(text) {
    return UI_LABEL_PATTERN.test(normalizeTitleText(text));
  }

  function isTimestampOnlyLine(text) {
    return Number.isFinite(parseTimestampText(normalizeTitleText(text)));
  }

  function compareNativeLabels(left, right) {
    return nativeLabelScore(right) - nativeLabelScore(left);
  }

  function nativeLabelScore(label) {
    if (!label) {
      return Number.NEGATIVE_INFINITY;
    }

    let score = 100;
    if (hasTrailingTruncationEllipsis(label)) {
      score -= 30;
    }
    if (label.length > 120) {
      score -= Math.min(40, Math.ceil((label.length - 120) / 6));
    }
    return score;
  }

  function hasTrailingTruncationEllipsis(text) {
    return /(?:\.{3}|…)$/.test(normalizeTitleText(text));
  }

  function isNativeTimestampSectionElement(element) {
    return Boolean(element.closest(NATIVE_TIMESTAMP_CONTAINER_SELECTOR));
  }

  globalThis.TimestampPlayerNativeTimestamps = {
    getNativeTimestampCandidates,
    isNativeTimestampSectionElement,
  };
})();
