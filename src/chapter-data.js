(() => {
  const MAX_CHAPTERS = 2000;
  const { normalizeTitleText, parseTimestampText } = globalThis.TimestampPlayerTimestamps;

  function chapterKindFromKey(key) {
    if (key === "DESCRIPTION_CHAPTERS" || key === "engagement-panel-macro-markers-description-chapters") {
      return "manual";
    }
    if (key === "AUTO_CHAPTERS" || key === "engagement-panel-macro-markers-auto-chapters") {
      return "automatic";
    }
    return "unknown";
  }

  function isChapterPanelId(id) {
    return typeof id === "string" && /^engagement-panel-macro-markers-(?:[a-z-]+-)?chapters$/.test(id);
  }

  function numericTime(value) {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : NaN;
    }
    return typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)
      ? Number(value) : NaN;
  }

  function textValue(value) {
    return normalizeTitleText(typeof value?.simpleText === "string" ? value.simpleText
      : (Array.isArray(value?.runs) ? value.runs : []).map((run) => typeof run?.text === "string" ? run.text : "").join(""));
  }

  // A structured list is already a timeline. Never run it through the comment
  // parser, which intentionally salvages increasing runs from noisy prose.
  function buildChapterTracks(candidates, duration, { requireZero = true } = {}) {
    if (!Array.isArray(candidates) || candidates.length > MAX_CHAPTERS
      || !Number.isFinite(duration) || duration <= 0) {
      return [];
    }
    const unique = [];
    for (const candidate of candidates) {
      const start = candidate?.start;
      const title = normalizeTitleText(candidate?.title);
      if (!Number.isFinite(start) || start < 0 || start >= duration) {
        return [];
      }
      const previous = unique[unique.length - 1];
      if (previous && start <= previous.start) {
        if (start === previous.start && title === previous.title) {
          continue;
        }
        return [];
      }
      unique.push({ start, title });
    }
    if (unique.length < 2 || (requireZero && unique[0].start !== 0)) {
      return [];
    }
    return unique.map((track, index) => ({
      ...track, index, end: unique[index + 1]?.start ?? duration,
    }));
  }

  function extractChapterSets(initialData, videoId) {
    if (!videoId || initialData?.currentVideoEndpoint?.watchEndpoint?.videoId !== videoId) {
      return [];
    }
    const sets = [];
    const decorated = initialData.playerOverlays?.playerOverlayRenderer?.decoratedPlayerBarRenderer;
    const bar = (decorated?.decoratedPlayerBarRenderer || decorated)?.playerBar?.multiMarkersPlayerBarRenderer;
    for (const [index, marker] of (Array.isArray(bar?.markersMap) ? bar.markersMap : []).entries()) {
      const chapters = marker?.value?.chapters;
      if (!Array.isArray(chapters) || chapters.length > MAX_CHAPTERS || marker.value.continuations?.length) {
        continue;
      }
      sets.push({
        channel: "chapter-markers", chapterKind: chapterKindFromKey(marker.key),
        sourceId: `markers:${index}`, complete: true,
        candidates: chapters.map((entry) => ({
          start: numericTime(entry?.chapterRenderer?.timeRangeStartMillis) / 1000,
          title: textValue(entry?.chapterRenderer?.title),
        })),
      });
    }
    for (const [index, entry] of (Array.isArray(initialData.engagementPanels) ? initialData.engagementPanels : []).entries()) {
      const panel = entry?.engagementPanelSectionListRenderer;
      const id = panel?.targetId || panel?.panelIdentifier;
      const list = panel?.content?.macroMarkersListRenderer;
      if (!isChapterPanelId(id) || !Array.isArray(list?.contents)
        || list.contents.length > MAX_CHAPTERS || list.continuations?.length) {
        continue;
      }
      // Info rows are harmless; continuation/unknown rows mean the list is not
      // known to be complete, so do not promote a partial timeline.
      if (list.contents.some((item) => !item?.macroMarkersListItemRenderer && !item?.macroMarkersInfoItemRenderer)) {
        continue;
      }
      const items = list.contents.flatMap((item) => item.macroMarkersListItemRenderer ? [item.macroMarkersListItemRenderer] : []);
      if (items.some((item) => item.onTap?.watchEndpoint?.videoId
        && item.onTap.watchEndpoint.videoId !== videoId)) {
        continue;
      }
      const candidates = items.map((item) => {
        const numeric = numericTime(item.onTap?.watchEndpoint?.startTimeSeconds);
        return {
          start: Number.isFinite(numeric) ? numeric : parseTimestampText(textValue(item.timeDescription)),
          title: textValue(item.title),
        };
      });
      sets.push({
        channel: "chapter-panel", chapterKind: chapterKindFromKey(id),
        sourceId: `panel:${index}`, complete: candidates[0]?.start === 0, candidates,
      });
    }
    return sets;
  }

  globalThis.TimestampPlayerChapterData = {
    buildChapterTracks,
    chapterKindFromKey,
    extractChapterSets,
    isChapterPanelId,
  };
})();
