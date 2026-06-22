(() => {
  const DEFAULT_MAX_COMMENT_BATCHES = 3;
  const DEFAULT_NEXT_API_PATH = "/youtubei/v1/next";
  const COMMENT_TEXT_KEYS = new Set([
    "contentText",
    "commentText",
  ]);

  const {
    parseCommentLikeCount,
  } = globalThis.TimestampPlayerCommentScoring || {};

  async function fetchCommentRecords({ maxBatches = DEFAULT_MAX_COMMENT_BATCHES, videoId = "" } = {}) {
    const pageData = await getYouTubePageData(videoId);
    const seenTokens = new Set();
    const initialContinuation = findBestCommentContinuation(pageData.initialData, {
      phase: "initial",
      seenTokens,
    });
    if (!initialContinuation?.token || !pageData.config?.INNERTUBE_CONTEXT) {
      return [];
    }

    const records = [];
    let continuation = initialContinuation;
    for (let batchIndex = 0; batchIndex < maxBatches && continuation?.token; batchIndex += 1) {
      seenTokens.add(continuation.token);
      const response = await fetchContinuation(pageData.config, continuation);
      const batchRecords = extractCommentRecords(response);
      for (const record of batchRecords) {
        records.push({
          ...record,
          order: records.length,
        });
      }

      continuation = findBestCommentContinuation(response, {
        phase: "next",
        seenTokens,
      });
    }

    return records;
  }

  async function getYouTubePageData(videoId = "") {
    const documentPageData = getYouTubePageDataFromScripts(getDocumentScriptTexts());
    if (!videoId || pageDataMatchesVideo(documentPageData.initialData, videoId)) {
      return documentPageData;
    }

    try {
      const fetchedPageData = await fetchWatchPageData(videoId);
      if (pageDataMatchesVideo(fetchedPageData.initialData, videoId)) {
        return fetchedPageData;
      }
    } catch (_error) {
      // Fall through to the empty result below; stale script data is worse than no fetch.
    }

    return {
      config: documentPageData.config,
      initialData: null,
    };
  }

  function getYouTubePageDataFromScripts(scriptTexts) {
    return {
      config: getYouTubeConfig(scriptTexts),
      initialData: getYouTubeInitialData(scriptTexts),
    };
  }

  async function fetchWatchPageData(videoId) {
    const url = new URL("/watch", location.origin);
    url.searchParams.set("v", videoId);
    const response = await fetch(url.toString(), {
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(`Watch page fetch failed: ${response.status}`);
    }

    return getYouTubePageDataFromScripts(extractScriptTextsFromHtml(await response.text()));
  }

  function pageDataMatchesVideo(initialData, videoId) {
    return initialData?.currentVideoEndpoint?.watchEndpoint?.videoId === videoId;
  }

  function getYouTubeConfig(scriptTexts) {
    const mergedConfig = {};
    for (const script of scriptTexts) {
      let searchIndex = 0;
      while (searchIndex < script.length) {
        const markerIndex = script.indexOf("ytcfg.set(", searchIndex);
        if (markerIndex === -1) {
          break;
        }

        const parsed = parseJsonObjectAfter(script, markerIndex + "ytcfg.set(".length);
        if (parsed) {
          Object.assign(mergedConfig, parsed.value);
          searchIndex = parsed.endIndex;
        } else {
          searchIndex = markerIndex + 1;
        }
      }
    }

    return mergedConfig;
  }

  function getYouTubeInitialData(scriptTexts) {
    const markers = [
      "var ytInitialData =",
      "window[\"ytInitialData\"] =",
      "window['ytInitialData'] =",
      "ytInitialData =",
    ];

    for (const script of scriptTexts) {
      for (const marker of markers) {
        const markerIndex = script.indexOf(marker);
        if (markerIndex === -1) {
          continue;
        }

        const parsed = parseJsonObjectAfter(script, markerIndex + marker.length);
        if (parsed) {
          return parsed.value;
        }
      }
    }

    return null;
  }

  function getDocumentScriptTexts() {
    return [...document.scripts]
      .map((script) => script.textContent || "")
      .filter(Boolean);
  }

  function extractScriptTextsFromHtml(html) {
    return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
      .map((match) => match[1] || "")
      .filter(Boolean);
  }

  function parseJsonObjectAfter(text, startIndex) {
    const objectStart = text.indexOf("{", startIndex);
    if (objectStart === -1) {
      return null;
    }

    const objectEnd = findBalancedObjectEnd(text, objectStart);
    if (objectEnd === -1) {
      return null;
    }

    try {
      return {
        value: JSON.parse(text.slice(objectStart, objectEnd + 1)),
        endIndex: objectEnd + 1,
      };
    } catch (_error) {
      return null;
    }
  }

  function findBalancedObjectEnd(text, startIndex) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    let quote = "";

    for (let index = startIndex; index < text.length; index += 1) {
      const char = text[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          inString = false;
        }
        continue;
      }

      if (char === "\"" || char === "'") {
        inString = true;
        quote = char;
        continue;
      }

      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          return index;
        }
      }
    }

    return -1;
  }

  function findBestCommentContinuation(root, { phase = "initial", seenTokens = new Set() } = {}) {
    const continuations = [];
    walkObjects(root, [], (value, ancestors, _key, path) => {
      const endpoint = value?.continuationEndpoint || value;
      const command = endpoint?.continuationCommand;
      const token = command?.token || value?.continuationCommand?.token;
      if (!token || seenTokens.has(token)) {
        return;
      }

      const apiUrl = endpoint?.commandMetadata?.webCommandMetadata?.apiUrl
        || value?.commandMetadata?.webCommandMetadata?.apiUrl
        || DEFAULT_NEXT_API_PATH;
      continuations.push({
        token,
        apiUrl,
        score: scoreContinuationCandidate(value, ancestors, apiUrl, token, path, phase),
      });
    });

    return continuations
      .filter((continuation) => continuation.score > 0)
      .sort((left, right) => right.score - left.score)[0] || null;
  }

  function scoreContinuationCandidate(value, ancestors, apiUrl, token, path, phase) {
    const text = stringifySmall([value, ...ancestors.slice(-4)]).toLowerCase();
    const pathText = path.join(".").toLowerCase();
    let score = 0;
    if (apiUrl.includes("/next")) {
      score += 10;
    }
    if (text.includes("comment")) {
      score += 35;
    }
    if (text.includes("comments-section") || text.includes("comment-item-section")) {
      score += 40;
    }
    if (text.includes("sort filter") || text.includes("comment section")) {
      score += 15;
    }
    if (text.includes("playlist") || text.includes("transcript")) {
      score -= 20;
    }
    if (phase === "next") {
      if (pathText.includes("sortfiltersubmenurenderer") || text.includes("showreloaduicommand")) {
        score -= 100;
      }
      if (pathText.includes("commentrepliesrenderer") || token.includes("Y29tbWVudC1yZXBsaWVz")) {
        score -= 100;
      }
      if (/continuationitems\.\d+\.continuationitemrenderer(?:\.continuationendpoint)?$/.test(pathText)) {
        score += 60;
      }
      if (token.includes("Z2V0X3JhbmtlZF9zdHJlYW1z")) {
        score += 40;
      }
    }
    return score;
  }

  function stringifySmall(value) {
    try {
      return JSON.stringify(value).slice(0, 12000);
    } catch (_error) {
      return "";
    }
  }

  async function fetchContinuation(config, continuation) {
    const url = new URL(continuation.apiUrl || DEFAULT_NEXT_API_PATH, location.origin);
    if (config.INNERTUBE_API_KEY && !url.searchParams.has("key")) {
      url.searchParams.set("key", config.INNERTUBE_API_KEY);
    }
    url.searchParams.set("prettyPrint", "false");

    const client = config.INNERTUBE_CONTEXT?.client || {};
    const headers = {
      "Content-Type": "application/json",
    };
    if (config.INNERTUBE_CONTEXT_CLIENT_NAME || client.clientName) {
      headers["X-YouTube-Client-Name"] = String(config.INNERTUBE_CONTEXT_CLIENT_NAME || client.clientName);
    }
    if (config.INNERTUBE_CONTEXT_CLIENT_VERSION || client.clientVersion) {
      headers["X-YouTube-Client-Version"] = String(config.INNERTUBE_CONTEXT_CLIENT_VERSION || client.clientVersion);
    }

    const response = await fetch(url.toString(), {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({
        context: config.INNERTUBE_CONTEXT,
        continuation: continuation.token,
      }),
    });

    if (!response.ok) {
      throw new Error(`Comment continuation fetch failed: ${response.status}`);
    }

    return response.json();
  }

  function extractCommentRecords(root) {
    const records = [];
    const pinnedCommentKeys = getPinnedCommentKeys(root);
    walkObjects(root, [], (value) => {
      if (value?.commentRenderer) {
        const record = parseCommentRenderer(value.commentRenderer);
        if (record?.text) {
          records.push(record);
        }
      }

      if (value?.commentViewModel) {
        const record = parseCommentViewModel(value.commentViewModel);
        if (record?.text) {
          records.push(record);
        }
      }

      if (value?.commentEntityPayload) {
        const record = parseCommentEntityPayload(value.commentEntityPayload, pinnedCommentKeys);
        if (record?.text) {
          records.push(record);
        }
      }
    });

    return dedupeCommentRecords(records);
  }

  function getPinnedCommentKeys(root) {
    const pinnedCommentKeys = new Set();
    walkObjects(root, [], (value) => {
      const model = value?.commentViewModel?.commentViewModel
        || value?.commentViewModel
        || value;
      if (model?.commentKey && model?.pinnedText) {
        pinnedCommentKeys.add(model.commentKey);
      }
    });
    return pinnedCommentKeys;
  }

  function parseCommentRenderer(renderer) {
    return {
      text: textFromTextObject(renderer.contentText),
      authorName: textFromTextObject(renderer.authorText),
      isPinned: Boolean(renderer.pinnedCommentBadge) || containsCommentFlag(renderer, "pinned"),
      isUploader: Boolean(renderer.authorIsChannelOwner),
      likeCount: parseLikeCountFromValue(renderer.voteCount),
    };
  }

  function parseCommentViewModel(model) {
    const authorRenderer = model.author?.commentAuthorRenderer || model.commentAuthorRenderer || {};
    return {
      text: textFromCommentViewModel(model),
      authorName: textFromTextObject(authorRenderer.authorText) || textFromTextObject(model.authorText),
      isPinned: containsCommentFlag(model, "pinned"),
      isUploader: Boolean(authorRenderer.authorIsChannelOwner || model.authorIsChannelOwner),
      likeCount: parseLikeCountFromValue(model.toolbar || model.commentActionButtonsRenderer),
    };
  }

  function parseCommentEntityPayload(entity, pinnedCommentKeys) {
    const properties = entity.properties || {};
    const author = entity.author || {};
    return {
      text: textFromTextObject(properties.content),
      authorName: author.displayName || properties.authorButtonA11y || "",
      isPinned: pinnedCommentKeys.has(entity.key),
      isUploader: Boolean(author.isCreator),
      likeCount: parseLikeCountFromValue(entity.toolbar),
    };
  }

  function textFromCommentViewModel(model) {
    if (typeof model.content?.content === "string") {
      return model.content.content;
    }
    if (typeof model.contentText === "string") {
      return model.contentText;
    }

    const directText = textFromTextObject(model.contentText)
      || textFromTextObject(model.commentText)
      || textFromTextObject(model.content);
    if (directText) {
      return directText;
    }

    const textContainers = [];
    walkObjects(model, [], (value, ancestors, key) => {
      if (COMMENT_TEXT_KEYS.has(key) && typeof value === "object") {
        textContainers.push(value);
      }
    });

    return textContainers.map(textFromTextObject).find(Boolean) || "";
  }

  function textFromTextObject(value) {
    if (!value) {
      return "";
    }
    if (typeof value === "string") {
      return value;
    }
    if (typeof value.simpleText === "string") {
      return value.simpleText;
    }
    if (typeof value.content === "string") {
      return value.content;
    }
    if (Array.isArray(value.runs)) {
      return value.runs.map((run) => run.text || "").join("");
    }
    return "";
  }

  function parseLikeCountFromValue(value) {
    if (!parseCommentLikeCount || !value) {
      return null;
    }

    const candidates = [];
    walkObjects(value, [], (entry) => {
      if (typeof entry === "string") {
        candidates.push(entry);
      } else if (entry?.accessibilityData?.label) {
        candidates.push(entry.accessibilityData.label);
      } else if (entry?.label) {
        candidates.push(entry.label);
      } else if (entry?.simpleText) {
        candidates.push(entry.simpleText);
      }
    });

    for (const candidate of candidates) {
      const count = parseCommentLikeCount(candidate);
      if (count !== null) {
        return count;
      }
    }

    return null;
  }

  function containsCommentFlag(value, flag) {
    return stringifySmall(value).toLowerCase().includes(flag);
  }

  function dedupeCommentRecords(records) {
    const deduped = [];
    const seen = new Set();
    for (const record of records) {
      const key = `${record.authorName || ""}:${record.text}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      deduped.push(record);
    }

    return deduped;
  }

  function walkObjects(value, ancestors, visitor, key = "", path = []) {
    if (!value || typeof value !== "object") {
      visitor(value, ancestors, key, path);
      return;
    }

    visitor(value, ancestors, key, path);
    const nextAncestors = [...ancestors, value];
    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        const childKey = String(index);
        walkObjects(entry, nextAncestors, visitor, childKey, [...path, childKey]);
      });
      return;
    }

    for (const [childKey, childValue] of Object.entries(value)) {
      walkObjects(childValue, nextAncestors, visitor, childKey, [...path, childKey]);
    }
  }

  globalThis.TimestampPlayerCommentFetching = {
    fetchCommentRecords,
  };
})();
