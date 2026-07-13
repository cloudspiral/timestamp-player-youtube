(() => {
  const YOUTUBE_MUSIC_DESCRIPTION_ROOT_SELECTORS = [
    "ytmusic-description-shelf-renderer #description",
    "ytmusic-description-shelf-renderer yt-formatted-string",
    "ytmusic-description-shelf-renderer",
  ];
  const DESCRIPTION_TOGGLE_SELECTOR = [
    "ytd-watch-metadata ytd-text-inline-expander #expand",
    "ytd-watch-metadata ytd-text-inline-expander #collapse",
    "ytd-watch-metadata #description-inline-expander #expand",
    "ytd-watch-metadata #description-inline-expander #collapse",
    "ytd-watch-metadata tp-yt-paper-button#expand",
    "ytd-watch-metadata tp-yt-paper-button#collapse",
    "ytd-watch-metadata ytd-text-inline-expander button[aria-expanded]",
    "ytd-watch-metadata #description-inline-expander button[aria-expanded]",
    "ytmusic-description-shelf-renderer #expand",
    "ytmusic-description-shelf-renderer #collapse",
    "ytmusic-description-shelf-renderer tp-yt-paper-button#expand",
    "ytmusic-description-shelf-renderer tp-yt-paper-button#collapse",
    "ytd-watch-metadata ytd-text-inline-expander button",
    "ytd-watch-metadata #description-inline-expander button",
  ].join(",");
  const LOCAL_DESCRIPTION_TOGGLE_SELECTOR = [
    "#expand",
    "#collapse",
    "tp-yt-paper-button#expand",
    "tp-yt-paper-button#collapse",
    "button[aria-expanded]",
    "button",
  ].join(",");
  const DESCRIPTION_EXPANDER_SELECTOR = [
    "ytd-text-inline-expander",
    "#description-inline-expander",
    "ytmusic-description-shelf-renderer",
  ].join(",");
  const DESCRIPTION_BLOCK_TAGS = new Set([
    "BLOCKQUOTE",
    "DIV",
    "H1",
    "H2",
    "H3",
    "H4",
    "LI",
    "P",
    "PRE",
    "SECTION",
  ]);
  const YOUTUBE_MUSIC_ACTION_ROW_SELECTORS = [
    "ytmusic-player-page #actions",
  ];
  const ACTION_ROW_SELECTOR = [
    "ytd-watch-metadata #top-level-buttons-computed",
    "ytd-watch-metadata ytd-menu-renderer #top-level-buttons-computed",
    "#above-the-fold #top-level-buttons-computed",
    ...YOUTUBE_MUSIC_ACTION_ROW_SELECTORS,
  ].join(",");
  const COMPACT_ACTION_ANCHOR_SELECTOR = [
    "ytd-watch-metadata #actions",
    "ytd-watch-metadata ytd-menu-renderer",
    "#above-the-fold #actions",
    "ytmusic-player-page #actions",
  ].join(",");
  const VIDEO_TITLE_SELECTORS = [
    "ytd-watch-metadata #title h1 yt-attributed-string",
    "ytd-watch-metadata #title h1 yt-formatted-string",
    "ytd-watch-metadata #title h1",
    "#above-the-fold #title h1 yt-attributed-string",
    "#above-the-fold #title h1 yt-formatted-string",
    "#above-the-fold #title h1",
    "ytmusic-player-page #header .title yt-formatted-string",
    "ytmusic-player-page #header yt-formatted-string.title",
    "ytmusic-player-page #header .title",
    "ytmusic-player-page #header #title",
  ];
  const SHARE_ACTION_SELECTOR = [
    "ytd-button-renderer#share-button",
    "yt-button-view-model#share-button",
    "button-view-model#share-button",
    "#share-button",
    "[data-button-id='share']",
    "[data-action-id='share']",
  ].join(",");
  const NATIVE_TIMESTAMP_SECTION_SELECTOR = [
    "ytd-horizontal-card-list-renderer",
    "ytd-macro-markers-list-renderer",
    "ytd-macro-markers-list-item-renderer",
  ].join(",");
  const COMMENT_BODY_SELECTORS = [
    "#content-text",
    "yt-attributed-string#content-text",
    "yt-formatted-string#content-text",
  ];
  const COMMENT_AUTHOR_SELECTORS = [
    "#author-text",
    "#author-text span",
    "a#author-text",
    "h3 a",
    "a[href^='/@']",
    "a[href*='/channel/']",
  ];
  const VIDEO_OWNER_IDENTITY_SELECTORS = [
    "ytd-watch-metadata ytd-video-owner-renderer #channel-name a",
    "ytd-watch-metadata #owner a.yt-simple-endpoint",
    "#upload-info #channel-name a",
    "ytd-watch-metadata ytd-video-owner-renderer #channel-name #text",
    "ytd-watch-metadata #owner #channel-name #text",
    "#upload-info #channel-name #text",
  ];
  const COMMENT_PIN_BADGE_SELECTOR = [
    "ytd-pinned-comment-badge-renderer",
    "yt-pinned-comment-badge-view-model",
    "#pinned-comment-badge",
  ].join(",");
  const COMMENT_UPLOADER_BADGE_SELECTOR = [
    "ytd-author-comment-badge-renderer",
    "yt-author-comment-badge-view-model",
    "#author-comment-badge",
  ].join(",");
  const COMMENT_VOTE_COUNT_SELECTOR = "#vote-count-middle, [id='vote-count-middle']";
  const COMMENT_LIKE_BUTTON_SELECTOR = [
    "ytd-comment-action-buttons-renderer #like-button button[aria-label]",
    "ytd-comment-action-buttons-renderer #like-button[aria-label]",
    "like-button-view-model button[aria-label]",
    "yt-like-button-view-model button[aria-label]",
  ].join(",");
  const QUIET_DESCRIPTION_SELECTORS = [
    "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-structured-description'] ytd-expandable-video-description-body-renderer",
    "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-structured-description'] ytd-structured-description-content-renderer",
  ];
  const DESCRIPTION_ROOT_SELECTORS = [
    "ytd-watch-metadata #description-inline-expander #expanded",
    "ytd-watch-metadata #description-inline-expander",
    "ytd-watch-metadata #description",
    ...YOUTUBE_MUSIC_DESCRIPTION_ROOT_SELECTORS,
  ];

  const {
    parseCommentLikeCount,
  } = globalThis.TimestampPlayerCommentScoring || {};
  const {
    isNativeTimestampSectionElement,
  } = globalThis.TimestampPlayerNativeTimestamps || {};
  const {
    getMusicPlayerVideoId,
    getWatchShellVideoId,
  } = globalThis.TimestampPlayerVideoOwnership;
  const {
    isElementTreeExplicitlyHidden,
  } = globalThis.TimestampPlayerDomVisibility;
  const {
    cleanTrackTitle,
    getTextTimestampCandidates,
    isTimestampRangeEndMarker,
    lineContainingTimestamp,
    normalizeTitleText,
    parseTimeParam,
    parseTimestampText,
    titleFromLineFragment,
  } = globalThis.TimestampPlayerTimestamps || {};

  function createYouTubeDom({
    Node: nodeTypes = globalThis.Node,
    document = globalThis.document,
    getComputedStyle: getComputedStyleFn = globalThis.getComputedStyle,
    location = globalThis.location,
  } = {}) {
    if (!document || !location || !nodeTypes) {
      throw new TypeError("YouTube DOM dependencies are required");
    }

    function findDescriptionExpandButton(videoId = "") {
      return findDescriptionToggle("expand", videoId);
    }

    function findDescriptionCollapseButton(videoId = "") {
      return findDescriptionToggle("collapse", videoId);
    }

    function findDescriptionToggle(intent, videoId) {
      return [...document.querySelectorAll(DESCRIPTION_TOGGLE_SELECTOR)].find((element) => {
        return isVisible(element)
          && elementBelongsToVideo(element, videoId)
          && getDescriptionToggleIntent(element) === intent;
      }) || null;
    }

    function findActionRow(videoId = "") {
      return [...document.querySelectorAll(ACTION_ROW_SELECTOR)].find((element) => {
        return isVisible(element) && elementBelongsToVideo(element, videoId);
      }) || null;
    }

    function findCompactActionAnchor(videoId = "") {
      const actionRow = findActionRow(videoId);
      const candidates = [
        actionRow?.closest("#actions"),
        actionRow?.closest("ytd-menu-renderer"),
        actionRow?.closest("ytmusic-player-page #actions"),
        actionRow?.parentElement,
        ...document.querySelectorAll(COMPACT_ACTION_ANCHOR_SELECTOR),
        actionRow,
      ].filter(Boolean);
      return candidates.find((element) => {
        return isVisible(element) && elementBelongsToVideo(element, videoId);
      }) || null;
    }

    function getVideoTitleLineRects(videoId = "") {
      if (!videoId) {
        return [];
      }
      for (const candidate of getUniqueElements(VIDEO_TITLE_SELECTORS)) {
        if (
          !isVisible(candidate)
          || !elementBelongsToVideo(candidate, videoId)
          || !normalizeTitleText(candidate.textContent)
        ) {
          continue;
        }
        const rects = getTextLineRects(candidate);
        if (rects.length > 0) {
          return rects;
        }
      }
      return [];
    }

    function getTextLineRects(element) {
      const range = document.createRange?.();
      if (!range) {
        return [];
      }
      try {
        range.selectNodeContents(element);
        return [...range.getClientRects()].map(copyRect).filter(Boolean);
      } catch (_error) {
        return [];
      } finally {
        range.detach?.();
      }
    }

    function copyRect(rect) {
      const left = Number(rect?.left);
      const top = Number(rect?.top);
      const right = Number(rect?.right);
      const bottom = Number(rect?.bottom);
      const width = Number(rect?.width);
      const height = Number(rect?.height);
      if (
        ![bottom, height, left, right, top, width].every(Number.isFinite)
        || width <= 0
        || height <= 0
      ) {
        return null;
      }
      return { bottom, height, left, right, top, width };
    }

    function insertLauncherButton(actionRow, launcherButton) {
      const shareControl = actionRow.querySelector(SHARE_ACTION_SELECTOR);
      const shareButton = getDirectChild(actionRow, shareControl);

      if (shareButton?.nextSibling) {
        actionRow.insertBefore(launcherButton, shareButton.nextSibling);
      } else {
        actionRow.append(launcherButton);
      }
    }

    function getDirectChild(parent, descendant) {
      let current = descendant;
      while (current?.parentElement && current.parentElement !== parent) {
        current = current.parentElement;
      }
      return current?.parentElement === parent ? current : null;
    }

    function getDescriptionRoots(videoId = "") {
      const quietRoots = getQuietDescriptionRoots(videoId);
      const renderedRoots = getUniqueElements(DESCRIPTION_ROOT_SELECTORS)
        .filter(isVisible)
        .filter((root) => rootBelongsToVideo(root, videoId));
      return uniqueElements([...quietRoots, ...renderedRoots]);
    }

    function getQuietDescriptionRoots(videoId = "") {
      return getUniqueElements(QUIET_DESCRIPTION_SELECTORS)
        .filter((root) => root.isConnected !== false)
        .filter((root) => rootBelongsToVideo(root, videoId));
    }

    function readDescriptionRoot(root, { sourceId, videoId } = {}) {
      const text = getDescriptionText(root);
      const normalizedText = normalizeTitleText(text);
      if (!normalizedText || isLikelyCollapsedDescriptionTextRoot(root, text)) {
        return null;
      }

      const textCandidates = getTextTimestampCandidates(text, `description-text:${sourceId}`);
      const titledTextStarts = new Set(
        textCandidates
          .filter((candidate) => candidate.title)
          .map((candidate) => candidate.start)
      );
      const linkCandidates = getLinkTimestampCandidates(videoId, [root], {
        excludeNativeTimestampSections: true,
      }).filter((candidate) => !titledTextStarts.has(candidate.start));
      const candidates = [...textCandidates, ...linkCandidates];
      return {
        candidateCount: candidates.length,
        candidates,
        normalizedText,
        text,
      };
    }

    function isDescriptionRootReadable(root) {
      const text = getDescriptionText(root);
      const normalizedText = normalizeTitleText(text);
      return normalizedText.length > 0
        && !isLikelyCollapsedDescriptionTextRoot(root, text);
    }

    function getOwnershipEvidence(root) {
      const linkedVideoIds = [];
      for (const link of root.querySelectorAll("a[href*='/watch']")) {
        const linkedVideoId = getTimestampLinkVideoId(link);
        if (linkedVideoId) {
          linkedVideoIds.push(linkedVideoId);
        }
      }

      const renderer = getOwningRenderer(root);
      return {
        linkedVideoIds,
        shellVideoId: renderer.videoId,
      };
    }

    function getCommentRoots(videoId = "") {
      const roots = [];
      for (const thread of document.querySelectorAll("ytd-comment-thread-renderer")) {
        addUniqueElement(
          roots,
          thread.querySelector("ytd-comment-view-model, ytd-comment-renderer") || thread
        );
      }

      for (const comment of document.querySelectorAll("ytd-comment-view-model, ytd-comment-renderer")) {
        if (!comment.closest("ytd-comment-thread-renderer")) {
          addUniqueElement(roots, comment);
        }
      }
      return roots
        .filter(isVisible)
        .filter((root) => rootBelongsToVideo(root, videoId));
    }

    function classifyCommentRoot(root, videoId = "") {
      return {
        isPinned: isPinnedComment(root),
        isUploader: isUploaderComment(root, videoId),
      };
    }

    function readCommentRoot(root, {
      sourceId,
      videoId = "",
      classification = classifyCommentRoot(root, videoId),
    } = {}) {
      const authorName = getCommentAuthorName(root);
      const bodyText = getCommentBodyText(root);
      return {
        authorName,
        bodyText,
        candidates: getTextTimestampCandidates(bodyText, `comment:${sourceId}`),
        isPinned: classification?.isPinned === true,
        isUploader: classification?.isUploader === true,
        likeCount: getCommentLikeCount(root),
      };
    }

    function isVideoOwner(authorSource, videoId = "") {
      const ownerIdentity = getFirstVisibleChannelIdentity(
        document,
        VIDEO_OWNER_IDENTITY_SELECTORS,
        videoId
      );
      const authorIdentity = typeof authorSource === "string"
        ? normalizeChannelIdentity(authorSource)
        : getFirstVisibleChannelIdentity(authorSource, COMMENT_AUTHOR_SELECTORS);
      return Boolean(
        ownerIdentity
        && authorIdentity
        && ownerIdentity === authorIdentity
      );
    }

    function getLinkTimestampCandidates(videoId, roots, options = {}) {
      const links = [];
      for (const searchRoot of roots) {
        for (const link of searchRoot.querySelectorAll("a[href*='/watch']")) {
          if (
            options.excludeNativeTimestampSections
            && isNativeTimestampSectionElement(link)
          ) {
            continue;
          }
          if (!links.includes(link)) {
            links.push(link);
          }
        }
      }
      return links.map((link) => toTimestampCandidate(link, videoId)).filter(Boolean);
    }

    function getTimestampLinkVideoId(link) {
      const url = new URL(link.href, location.href);
      const linkedVideoId = url.searchParams.get("v");
      if (!linkedVideoId) {
        return "";
      }

      const timeParamStart = parseTimeParam(url.searchParams.get("t"));
      const textStart = parseTimestampText(link.textContent);
      return Number.isFinite(timeParamStart) || Number.isFinite(textStart)
        ? linkedVideoId
        : "";
    }

    function getOwningRenderer(element) {
      const watchShell = element?.closest?.("ytd-watch-flexy") || null;
      if (watchShell) {
        return {
          element: watchShell,
          kind: "watch",
          videoId: getWatchShellVideoId(watchShell),
        };
      }

      const musicPlayerPage = element?.closest?.("ytmusic-player-page") || null;
      if (musicPlayerPage) {
        return {
          element: musicPlayerPage,
          kind: "music",
          videoId: getMusicPlayerVideoId(musicPlayerPage),
        };
      }

      return { element: null, kind: "", videoId: "" };
    }

    function elementBelongsToVideo(element, videoId) {
      if (!videoId) {
        return true;
      }
      const renderer = getOwningRenderer(element);
      return Boolean(renderer.element && renderer.videoId === videoId);
    }

    function rootBelongsToVideo(root, videoId) {
      if (!videoId) {
        return true;
      }

      const linkedVideoIds = [...root.querySelectorAll("a[href*='/watch']")]
        .map(getTimestampLinkVideoId)
        .filter(Boolean);
      if (linkedVideoIds.length > 0) {
        return linkedVideoIds.every((linkedVideoId) => linkedVideoId === videoId);
      }

      const renderer = getOwningRenderer(root);
      if (renderer.element) {
        return renderer.videoId === videoId;
      }
      return false;
    }

    function isLikelyCollapsedDescriptionTextRoot(root, text) {
      const rootState = getDescriptionExpandedState(root);
      if (rootState !== null) {
        return rootState === false;
      }

      const hasTruncatedTimestamp = text.split(/\r?\n/).some((line) => {
        return hasTimestampText(line) && /(?:\.{3}|…)/.test(normalizeTitleText(line));
      });
      if (!hasTruncatedTimestamp) {
        return false;
      }

      const visibleControls = [...root.querySelectorAll(LOCAL_DESCRIPTION_TOGGLE_SELECTOR)]
        .filter(isVisible);
      if (visibleControls.some((element) => getDescriptionToggleIntent(element) === "expand")) {
        return true;
      }
      if (visibleControls.some((element) => getDescriptionToggleIntent(element) === "collapse")) {
        return false;
      }

      return false;
    }

    function hasTimestampText(text) {
      return /\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(text);
    }

    function getDescriptionToggleIntent(element) {
      if (element.id === "expand") {
        return "expand";
      }
      if (element.id === "collapse") {
        return "collapse";
      }

      const ariaExpanded = getBooleanAttribute(element, "aria-expanded");
      if (ariaExpanded !== null) {
        return ariaExpanded ? "collapse" : "expand";
      }

      const expander = element.closest?.(DESCRIPTION_EXPANDER_SELECTOR) || null;
      const structuralState = getDescriptionExpandedState(expander);
      if (structuralState !== null) {
        return structuralState ? "collapse" : "expand";
      }

      const text = normalizeTitleText(element.textContent).toLowerCase();
      if (text.includes("show less")) {
        return "collapse";
      }
      return text.includes("more") ? "expand" : "";
    }

    function getDescriptionExpandedState(element) {
      if (!element) {
        return null;
      }

      const candidates = [
        element,
        element.closest?.(DESCRIPTION_EXPANDER_SELECTOR),
      ].filter((candidate, index, values) => {
        return candidate && values.indexOf(candidate) === index;
      });
      for (const candidate of candidates) {
        const ariaExpanded = getBooleanAttribute(candidate, "aria-expanded");
        if (ariaExpanded !== null) {
          return ariaExpanded;
        }
        for (const attribute of ["expanded", "is-expanded"]) {
          const expanded = getBooleanAttribute(candidate, attribute, true);
          if (expanded !== null) {
            return expanded;
          }
        }
        for (const attribute of ["collapsed", "is-collapsed"]) {
          const collapsed = getBooleanAttribute(candidate, attribute, true);
          if (collapsed !== null) {
            return !collapsed;
          }
        }
      }
      if (candidates.some((candidate) => candidate.id === "expanded")) {
        return true;
      }
      return null;
    }

    function getBooleanAttribute(element, name, emptyMeansTrue = false) {
      if (!element?.getAttribute) {
        return null;
      }
      const value = element.getAttribute(name);
      if (value === "true") {
        return true;
      }
      if (value === "false") {
        return false;
      }
      return emptyMeansTrue && value === "" ? true : null;
    }

    function getDescriptionText(root) {
      const originalText = root.innerText || root.textContent || "";
      const nativeSections = [
        ...root.querySelectorAll(NATIVE_TIMESTAMP_SECTION_SELECTOR),
      ];
      if (nativeSections.length === 0) {
        return originalText;
      }

      const parts = [];
      for (const child of root.childNodes || []) {
        appendDescriptionText(child, parts);
      }
      return parts.join("")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    function appendDescriptionText(node, parts) {
      if (node.nodeType === nodeTypes.TEXT_NODE) {
        parts.push(node.nodeValue || "");
        return;
      }
      if (node.nodeType !== nodeTypes.ELEMENT_NODE || isNativeTimestampNode(node)) {
        return;
      }
      if (node.tagName === "BR") {
        appendDescriptionLineBreak(parts);
        return;
      }

      const isBlock = DESCRIPTION_BLOCK_TAGS.has(node.tagName);
      if (isBlock) {
        appendDescriptionLineBreak(parts);
      }
      for (const child of node.childNodes || []) {
        appendDescriptionText(child, parts);
      }
      if (isBlock) {
        appendDescriptionLineBreak(parts);
      }
    }

    function appendDescriptionLineBreak(parts) {
      if (parts.length > 0 && !parts.at(-1).endsWith("\n")) {
        parts.push("\n");
      }
    }

    function isNativeTimestampNode(element) {
      return element.matches?.(NATIVE_TIMESTAMP_SECTION_SELECTOR)
        || isNativeTimestampSectionElement?.(element) === true;
    }

    function getUniqueElements(selectors) {
      const roots = [];
      for (const selector of selectors) {
        for (const root of document.querySelectorAll(selector)) {
          if (!roots.includes(root)) {
            roots.push(root);
          }
        }
      }
      return roots;
    }

    function uniqueElements(elements) {
      return [...new Set(elements)];
    }

    function addUniqueElement(elements, element) {
      if (element && !elements.includes(element)) {
        elements.push(element);
      }
    }

    function isPinnedComment(root) {
      return hasVisibleDescendant(root, COMMENT_PIN_BADGE_SELECTOR);
    }

    function isUploaderComment(root, videoId) {
      if (hasVisibleDescendant(root, COMMENT_UPLOADER_BADGE_SELECTOR)) {
        return true;
      }
      return isVideoOwner(root, videoId);
    }

    function getCommentAuthorName(root) {
      for (const selector of COMMENT_AUTHOR_SELECTORS) {
        const element = root.querySelector(selector);
        if (element && isVisible(element)) {
          const text = normalizeTitleText(element.textContent);
          if (text) {
            return text;
          }
        }
      }
      return "";
    }

    function hasVisibleDescendant(root, selector) {
      return [...root.querySelectorAll(selector)].some(isVisible);
    }

    function getFirstVisibleChannelIdentity(root, selectors, videoId = "") {
      if (!root?.querySelectorAll) {
        return "";
      }
      for (const selector of selectors) {
        for (const element of root.querySelectorAll(selector)) {
          if (
            !isVisible(element)
            || root === document && !elementBelongsToVideo(element, videoId)
          ) {
            continue;
          }
          const identity = getChannelIdentityFromElement(element);
          if (identity) {
            return identity;
          }
        }
      }
      return "";
    }

    function getChannelIdentityFromElement(element) {
      const href = element.getAttribute?.("href") || element.href || "";
      return normalizeChannelIdentity(href)
        || normalizeChannelHandle(element.textContent);
    }

    function normalizeChannelIdentity(value) {
      const handleIdentity = normalizeChannelHandle(value);
      if (handleIdentity) {
        return handleIdentity;
      }

      let url;
      try {
        url = new URL(String(value || ""), location.href);
      } catch (_error) {
        return "";
      }
      if (!/(^|\.)youtube\.com$/i.test(url.hostname)) {
        return "";
      }

      const channelMatch = url.pathname.match(/^\/channel\/([^/]+)/i);
      if (channelMatch) {
        return `channel:${channelMatch[1]}`;
      }
      const handleMatch = url.pathname.match(/^\/@([^/]+)/);
      return handleMatch
        ? `handle:${decodeUrlComponent(handleMatch[1]).toLowerCase()}`
        : "";
    }

    function normalizeChannelHandle(value) {
      const normalized = normalizeTitleText(value);
      return /^@\S+$/u.test(normalized)
        ? `handle:${normalized.slice(1).toLowerCase()}`
        : "";
    }

    function decodeUrlComponent(value) {
      try {
        return decodeURIComponent(value);
      } catch (_error) {
        return value;
      }
    }

    function getCommentBodyText(root) {
      for (const selector of COMMENT_BODY_SELECTORS) {
        const element = root.querySelector(selector);
        if (element && isVisible(element)) {
          const text = element.innerText || element.textContent || "";
          if (normalizeTitleText(text)) {
            return text;
          }
        }
      }
      return root.innerText || root.textContent || "";
    }

    function getCommentLikeCount(root) {
      for (const voteCount of root.querySelectorAll(COMMENT_VOTE_COUNT_SELECTOR)) {
        if (isVisible(voteCount)) {
          const parsedVoteCount = parseVisibleLikeCount(voteCount.textContent || "");
          if (parsedVoteCount !== null) {
            return parsedVoteCount;
          }
        }
      }

      for (const element of root.querySelectorAll(COMMENT_LIKE_BUTTON_SELECTOR)) {
        if (!isVisible(element)) {
          continue;
        }
        const label = element.getAttribute("aria-label") || "";
        if (!isKnownLikeButtonLabel(label)) {
          continue;
        }
        const parsedLabelCount = parseVisibleLikeCount(label);
        if (parsedLabelCount !== null) {
          return parsedLabelCount;
        }
      }
      return null;
    }

    function isKnownLikeButtonLabel(label) {
      const normalized = normalizeTitleText(label);
      if (!/\d/.test(normalized) || /^(?:unlike|dislike)\b/i.test(normalized)) {
        return false;
      }
      return /^like this comment\b.*\b\d[\d,.]*\s*[kmb]?(?:\s+other|\s+people|\s+likes?)/i
        .test(normalized)
        || /^\d[\d,.]*\s*[kmb]?\s+likes?\b/i.test(normalized)
        || /^likes?\s*:\s*\d/i.test(normalized);
    }

    function parseVisibleLikeCount(value) {
      if (!parseCommentLikeCount) {
        return null;
      }
      const count = parseCommentLikeCount(value);
      return Number.isFinite(count) && count >= 0 ? count : null;
    }

    function toTimestampCandidate(link, videoId) {
      const url = new URL(link.href, location.href);
      const linkedVideoId = url.searchParams.get("v");
      if (linkedVideoId && linkedVideoId !== videoId) {
        return null;
      }

      const timeParamStart = parseTimeParam(url.searchParams.get("t"));
      const start = Number.isFinite(timeParamStart)
        ? timeParamStart
        : parseTimestampText(link.textContent);
      if (!Number.isFinite(start)) {
        return null;
      }

      const timestampText = link.textContent.trim();
      const lineText = getTimestampLineText(link);
      if (isTimestampRangeEndMarker(lineText, timestampText)) {
        return null;
      }
      return {
        start,
        timestampText,
        title: cleanTrackTitle(extractTrackTitle(link, lineText)),
        lineKey: normalizeTitleText(lineText),
      };
    }

    function extractTrackTitle(link, lineText = getTimestampLineText(link)) {
      const timestamp = link.textContent.trim();
      const lineTitle = titleFromLineFragment(lineText, timestamp);
      if (lineTitle) {
        return lineTitle;
      }
      const inlineText = collectTextAfterTimestampLink(link);
      return titleFromLineFragment(inlineText, timestamp);
    }

    function getTimestampLineText(link) {
      const container = link.closest(
        ".ytAttributedStringHost, yt-attributed-string, #description, div, li, p"
      );
      const startNode = link.closest(".ytAttributedStringLinkInheritColor") || link;
      const nodeLineText = getLineTextForNode(container, startNode);
      if (nodeLineText) {
        return nodeLineText;
      }
      const text = container?.innerText || container?.textContent || "";
      return lineContainingTimestamp(text, link.textContent.trim());
    }

    function getLineTextForNode(container, targetNode) {
      if (!container || !targetNode || !container.contains(targetNode)) {
        return "";
      }

      let text = "";
      let targetOffset = -1;
      function visit(node) {
        if (node === targetNode) {
          targetOffset = text.length;
        }
        if (node.nodeType === nodeTypes.TEXT_NODE) {
          text += node.nodeValue || "";
          return;
        }
        if (node.nodeType !== nodeTypes.ELEMENT_NODE) {
          return;
        }
        if (node.tagName === "BR") {
          text += "\n";
          return;
        }
        for (const child of node.childNodes) {
          visit(child);
        }
      }

      visit(container);
      if (targetOffset === -1) {
        return "";
      }
      const lineStart = text.lastIndexOf("\n", Math.max(0, targetOffset - 1)) + 1;
      const lineEnd = text.indexOf("\n", targetOffset);
      return text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
    }

    function collectTextAfterTimestampLink(link) {
      const container = link.closest(
        ".ytAttributedStringHost, yt-attributed-string, #description, div, li, p"
      );
      const startNode = link.closest(".ytAttributedStringLinkInheritColor") || link;
      if (!container || !container.contains(startNode)) {
        return "";
      }

      let collecting = false;
      let text = "";
      function visit(node) {
        if (node === startNode) {
          collecting = true;
          return false;
        }
        if (collecting && node.nodeType === nodeTypes.ELEMENT_NODE && node.matches("a")) {
          return true;
        }
        if (collecting && node.nodeType === nodeTypes.TEXT_NODE) {
          text += node.nodeValue;
          return false;
        }
        if (collecting && node.nodeType === nodeTypes.ELEMENT_NODE && node.tagName === "BR") {
          text += "\n";
          return false;
        }
        for (const child of node.childNodes) {
          if (visit(child)) {
            return true;
          }
        }
        return false;
      }

      visit(container);
      return text;
    }

    function isVisible(element) {
      const rect = element.getBoundingClientRect();
      return rect.width > 0
        && rect.height > 0
        && !isElementTreeExplicitlyHidden(element, getComputedStyleFn);
    }

    return {
      classifyCommentRoot,
      findActionRow,
      findCompactActionAnchor,
      findDescriptionCollapseButton,
      findDescriptionExpandButton,
      getCommentRoots,
      getDescriptionRoots,
      getOwnershipEvidence,
      getQuietDescriptionRoots,
      getVideoTitleLineRects,
      insertLauncherButton,
      isDescriptionRootReadable,
      isVideoOwner,
      readCommentRoot,
      readDescriptionRoot,
    };
  }

  globalThis.TimestampPlayerYouTubeDom = {
    createYouTubeDom,
  };
})();
