(() => {
  const NATIVE_TIMESTAMP_SECTION_SELECTOR = [
    "ytd-horizontal-card-list-renderer",
    "ytd-macro-markers-list-renderer",
  ].join(",");
  const NATIVE_TIMESTAMP_ITEM_SELECTOR = [
    "ytd-macro-markers-list-item-renderer",
    "yt-lockup-view-model",
    "[role='listitem']",
    "li",
  ].join(",");
  const NATIVE_TIMESTAMP_CONTAINER_SELECTOR = [
    NATIVE_TIMESTAMP_SECTION_SELECTOR,
    "ytd-macro-markers-list-item-renderer",
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
  const {
    getWatchShellVideoId,
  } = globalThis.TimestampPlayerVideoOwnership;

  function getNativeTimestampCandidates(videoId, root = document) {
    return getNativeTimestampDiscovery(videoId, root).candidates;
  }

  function getNativeTimestampDiscovery(videoId, root = document) {
    const candidates = [];
    const groups = [];
    const seen = new Set();
    let sawRelevantMismatchedVideoId = false;

    for (const container of getNativeTimestampContainers(root)) {
      if (!isVisibleContainer(container) || belongsToDifferentWatchShell(container, videoId)) {
        continue;
      }

      const links = getUniqueTimestampLinks(container);
      const groupCandidates = links
        .map((link) => toNativeTimestampCandidate(link, videoId))
        .filter(Boolean);
      const timestampLinkCount = links.filter(hasParseableTimestamp).length;
      const isHorizontalSection = container.matches?.("ytd-horizontal-card-list-renderer") === true;
      if (timestampLinkCount >= 2 || !isHorizontalSection) {
        sawRelevantMismatchedVideoId = sawRelevantMismatchedVideoId
          || links.some((link) => hasMismatchedTimestampVideoId(link, videoId));
      }
      if (isHorizontalSection && groupCandidates.length < 2) {
        continue;
      }

      const panel = container.closest?.("ytd-engagement-panel-section-list-renderer");
      const panelId = panel?.getAttribute?.("target-id") || panel?.getAttribute?.("panel-identifier") || "";
      groups.push({
        candidates: groupCandidates,
        panelId,
        incomplete: timestampLinkCount > groupCandidates.length
          || Boolean(container.querySelector?.("ytd-continuation-item-renderer")),
      });

      for (const candidate of groupCandidates) {
        const key = `${candidate.start}:${candidate.lineKey}`;
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        candidates.push(candidate);
      }
    }

    return {
      candidates,
      groups,
      hasMismatchedVideoId: candidates.length === 0 && sawRelevantMismatchedVideoId,
    };
  }

  function getNativeTimestampContainers(root) {
    const containers = [];
    const seen = new Set();
    for (const container of root.querySelectorAll(NATIVE_TIMESTAMP_CONTAINER_SELECTOR)) {
      const enclosingSection = container.closest?.(NATIVE_TIMESTAMP_SECTION_SELECTOR) || null;
      if (enclosingSection && enclosingSection !== container) {
        continue;
      }
      if (!seen.has(container)) {
        seen.add(container);
        containers.push(container);
      }
    }
    return containers;
  }

  function getUniqueTimestampLinks(container) {
    return [...new Set(container.querySelectorAll("a[href*='/watch']"))];
  }

  function hasParseableTimestamp(link) {
    const url = new URL(link.href, location.href);
    return Number.isFinite(parseTimeParam(url.searchParams.get("t")))
      || Number.isFinite(parseTimestampText(normalizeTitleText(link.textContent)));
  }

  function hasMismatchedTimestampVideoId(link, videoId) {
    if (!hasParseableTimestamp(link)) {
      return false;
    }
    const linkedVideoId = new URL(link.href, location.href).searchParams.get("v");
    return Boolean(linkedVideoId && linkedVideoId !== videoId);
  }

  function isVisibleContainer(container) {
    if (typeof container.getBoundingClientRect !== "function") {
      return true;
    }
    const rect = container.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function belongsToDifferentWatchShell(container, videoId) {
    const watchShell = container.closest?.("ytd-watch-flexy") || null;
    if (!watchShell) {
      return false;
    }
    const shellVideoId = getWatchShellVideoId(watchShell);
    return Boolean(shellVideoId && shellVideoId !== videoId);
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
    const rawTitle = getBestNativeLabel(link, item)
      || (!isTimestampOnlyLine(timestampText) ? timestampText : "");
    const title = cleanNativeTitle(rawTitle, timestampText);
    const itemText = getScopedItemLabel(link, item);
    const lineKey = normalizeTitleText(itemText || `${timestampText}:${title}`);
    const watchShell = link.closest?.("ytd-watch-flexy") || null;
    const shellVideoId = getWatchShellVideoId(watchShell);

    return {
      start,
      timestampText,
      title,
      lineKey,
      linkedVideoId: linkedVideoId || "",
      shellVideoId,
    };
  }

  function getNativeTimestampItem(link) {
    const section = link.closest?.(NATIVE_TIMESTAMP_SECTION_SELECTOR) || null;
    const closestItem = link.closest?.(NATIVE_TIMESTAMP_ITEM_SELECTOR) || null;
    if (closestItem && closestItem !== link && closestItem !== section) {
      return closestItem;
    }

    let fallback = null;
    let current = link.parentElement || null;
    while (current && current !== section) {
      if (!hasCompetingTimestampLinks(current, link)) {
        fallback ||= current;
        if (hasLocalLabelEvidence(link, current)) {
          return current;
        }
      }
      current = current.parentElement || null;
    }

    return fallback;
  }

  function getBestNativeLabel(link, item) {
    const labelSources = [
      ...getAttributeLabels(link),
      ...getAttributeLabels(item),
      ...getNearbyTextLabels(link, item),
      getScopedItemLabel(link, item),
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

  function getScopedItemLabel(link, item) {
    if (!item || item === link || hasCompetingTimestampLinks(item, link)) {
      return "";
    }

    return item.innerText || item.textContent || "";
  }

  function hasLocalLabelEvidence(link, item) {
    if (getAttributeLabels(item).some((label) => cleanNativeLabelText(label))) {
      return true;
    }

    if (getNearbyTextLabels(link, item).some((label) => cleanNativeLabelText(label))) {
      return true;
    }

    const itemText = normalizeTitleText(item?.innerText || item?.textContent);
    const linkText = normalizeTitleText(link.textContent);
    return Boolean(itemText && itemText !== linkText && !isTimestampOnlyLine(itemText));
  }

  function hasCompetingTimestampLinks(item, referenceLink) {
    if (!item?.querySelectorAll) {
      return false;
    }

    for (const link of item.querySelectorAll("a[href*='/watch']")) {
      if (link === referenceLink || link.href === referenceLink.href) {
        continue;
      }

      const url = new URL(link.href, location.href);
      const urlStart = parseTimeParam(url.searchParams.get("t"));
      const textStart = parseTimestampText(normalizeTitleText(link.textContent));
      if (Number.isFinite(urlStart) || Number.isFinite(textStart)) {
        return true;
      }
    }

    return false;
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
    let normalized = normalizeTitleText(text);
    if (isTimestampOnlyLine(timestampText)) {
      normalized = normalized.replace(timestampText, "");
    }
    const withoutTimestamp = normalized
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
    return Boolean(element?.closest?.(NATIVE_TIMESTAMP_CONTAINER_SELECTOR));
  }

  globalThis.TimestampPlayerNativeTimestamps = {
    getNativeTimestampCandidates,
    getNativeTimestampDiscovery,
    isNativeTimestampSectionElement,
  };
})();
