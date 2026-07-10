(() => {
  const DEFAULT_MAX_COMMENT_BATCHES = 3;
  const DEFAULT_COMMENT_FETCH_TIMEOUT_MS = 10000;
  const DEFAULT_NEXT_API_PATH = "/youtubei/v1/next";
  const COMMENT_FETCH_OUTCOMES = Object.freeze({
    SUCCESS: "success",
    PARTIAL: "partial",
    NO_RESULTS: "no-results",
    TRANSIENT_ERROR: "transient-error",
    UNSUPPORTED: "unsupported",
    ABORTED: "aborted",
  });
  const CONTINUATION_ENVELOPE_KEYS = new Set([
    "appendContinuationItemsAction",
    "continuationContents",
    "onResponseReceivedActions",
    "onResponseReceivedCommands",
    "onResponseReceivedEndpoints",
    "reloadContinuationItemsCommand",
  ]);
  const COMMENT_TEXT_KEYS = new Set([
    "contentText",
    "commentText",
  ]);

  const {
    parseCommentLikeCount,
  } = globalThis.TimestampPlayerCommentScoring || {};

  async function fetchCommentRecords({
    maxBatches = DEFAULT_MAX_COMMENT_BATCHES,
    signal,
    timeoutMs = DEFAULT_COMMENT_FETCH_TIMEOUT_MS,
    videoId = "",
  } = {}) {
    const records = [];
    let batchesFetched = 0;
    const boundedAbort = createBoundedAbortSignal(signal, timeoutMs);

    try {
      if (typeof globalThis.fetch !== "function") {
        throw createCommentFetchFailure("unsupported", "fetch-unavailable");
      }

      const pageData = await getYouTubePageData(videoId, boundedAbort.signal);
      if (!pageData.config?.INNERTUBE_CONTEXT) {
        throw createCommentFetchFailure("unsupported", "missing-innertube-context");
      }

      const seenTokens = new Set();
      const initialContinuation = findBestCommentContinuation(pageData.initialData, {
        phase: "initial",
        seenTokens,
      });
      if (!initialContinuation?.token) {
        throw createCommentFetchFailure("unsupported", "missing-comment-continuation");
      }

      let continuation = initialContinuation;
      const batchLimit = Math.max(1, Number(maxBatches) || DEFAULT_MAX_COMMENT_BATCHES);
      for (let batchIndex = 0; batchIndex < batchLimit && continuation?.token; batchIndex += 1) {
        seenTokens.add(continuation.token);
        const response = await fetchContinuation(pageData.config, continuation, boundedAbort.signal);
        if (!isSupportedContinuationResponse(response)) {
          throw createCommentFetchFailure("unsupported", "unsupported-continuation-response");
        }

        batchesFetched += 1;
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

      return createCommentFetchResult(
        records.length > 0 ? COMMENT_FETCH_OUTCOMES.SUCCESS : COMMENT_FETCH_OUTCOMES.NO_RESULTS,
        records,
        { batchesFetched }
      );
    } catch (error) {
      const failure = classifyCommentFetchFailure(error, {
        parentSignal: signal,
        timedOut: boundedAbort.timedOut(),
      });
      const status = failure.reason === "aborted"
        ? COMMENT_FETCH_OUTCOMES.ABORTED
        : records.length > 0
          ? COMMENT_FETCH_OUTCOMES.PARTIAL
          : failure.kind === "unsupported"
            ? COMMENT_FETCH_OUTCOMES.UNSUPPORTED
            : COMMENT_FETCH_OUTCOMES.TRANSIENT_ERROR;
      return createCommentFetchResult(status, records, {
        batchesFetched,
        reason: failure.reason,
        retryable: failure.reason !== "aborted" && !signal?.aborted,
      });
    } finally {
      boundedAbort.cleanup();
    }
  }

  function createCommentFetchResult(status, records, {
    batchesFetched = 0,
    reason = "",
    retryable = false,
  } = {}) {
    return {
      status,
      records,
      batchesFetched,
      reason,
      retryable,
    };
  }

  async function getYouTubePageData(videoId = "", signal) {
    const documentPageData = getYouTubePageDataFromScripts(getDocumentScriptTexts());
    if (!videoId || pageDataMatchesVideo(documentPageData.initialData, videoId)) {
      return documentPageData;
    }

    const fetchedPageData = await fetchWatchPageData(videoId, signal);
    if (pageDataMatchesVideo(fetchedPageData.initialData, videoId)) {
      return fetchedPageData;
    }

    throw createCommentFetchFailure("unsupported", "stale-watch-page-data");
  }

  function getYouTubePageDataFromScripts(scriptTexts) {
    return {
      config: getYouTubeConfig(scriptTexts),
      initialData: getYouTubeInitialData(scriptTexts),
    };
  }

  async function fetchWatchPageData(videoId, signal) {
    const url = new URL("/watch", location.origin);
    url.searchParams.set("v", videoId);
    const response = await fetchWithSignal(url.toString(), {
      credentials: "include",
      signal,
    }, signal);
    if (!response.ok) {
      throw createHttpFailure(response.status, "watch-page");
    }

    const html = await waitForPromiseWithSignal(
      Promise.resolve().then(() => response.text()),
      signal
    );
    return getYouTubePageDataFromScripts(extractScriptTextsFromHtml(html));
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

  async function fetchContinuation(config, continuation, signal) {
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

    const response = await fetchWithSignal(url.toString(), {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({
        context: config.INNERTUBE_CONTEXT,
        continuation: continuation.token,
      }),
      signal,
    }, signal);

    if (!response.ok) {
      throw createHttpFailure(response.status, "comment-continuation");
    }

    try {
      return await waitForPromiseWithSignal(
        Promise.resolve().then(() => response.json()),
        signal
      );
    } catch (error) {
      if (error?.commentFetchFailure || error?.name === "AbortError") {
        throw error;
      }
      if (error?.name !== "SyntaxError") {
        throw error;
      }
      throw createCommentFetchFailure("unsupported", "invalid-continuation-json");
    }
  }

  function isSupportedContinuationResponse(root) {
    if (!root || typeof root !== "object" || Array.isArray(root)) {
      return false;
    }

    let supported = false;
    walkObjects(root, [], (value, _ancestors, key) => {
      if (
        CONTINUATION_ENVELOPE_KEYS.has(key)
        || value?.commentRenderer
        || value?.commentViewModel
        || value?.commentEntityPayload
      ) {
        supported = true;
      }
    });
    return supported;
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

  function createBoundedAbortSignal(parentSignal, timeoutMs) {
    const controller = new AbortController();
    const normalizedTimeoutMs = Math.max(0, Number(timeoutMs) || 0);
    let timeoutId = null;
    let didTimeOut = false;

    const abortFromParent = () => {
      if (!controller.signal.aborted) {
        controller.abort(createCommentFetchFailure("transient", "aborted"));
      }
    };

    if (parentSignal?.aborted) {
      abortFromParent();
    } else if (parentSignal) {
      parentSignal.addEventListener("abort", abortFromParent, { once: true });
    }

    if (!controller.signal.aborted && normalizedTimeoutMs > 0) {
      timeoutId = globalThis.setTimeout(() => {
        didTimeOut = true;
        controller.abort(createCommentFetchFailure("transient", "timeout"));
      }, normalizedTimeoutMs);
    }

    return {
      signal: controller.signal,
      timedOut: () => didTimeOut,
      cleanup() {
        if (timeoutId !== null) {
          globalThis.clearTimeout(timeoutId);
        }
        parentSignal?.removeEventListener("abort", abortFromParent);
      },
    };
  }

  function fetchWithSignal(url, options, signal) {
    return waitForPromiseWithSignal(
      Promise.resolve().then(() => globalThis.fetch(url, options)),
      signal
    );
  }

  function waitForPromiseWithSignal(promise, signal) {
    if (signal?.aborted) {
      return Promise.reject(signal.reason || createCommentFetchFailure("transient", "aborted"));
    }

    return new Promise((resolve, reject) => {
      const rejectOnAbort = () => {
        signal.removeEventListener("abort", rejectOnAbort);
        reject(signal.reason || createCommentFetchFailure("transient", "aborted"));
      };
      signal?.addEventListener("abort", rejectOnAbort, { once: true });

      Promise.resolve(promise)
        .then(resolve, reject)
        .finally(() => signal?.removeEventListener("abort", rejectOnAbort));
    });
  }

  function createHttpFailure(status, requestType) {
    const numericStatus = Number(status) || 0;
    const kind = numericStatus === 408 || numericStatus === 429 || numericStatus >= 500
      ? "transient"
      : "unsupported";
    return createCommentFetchFailure(kind, `${requestType}-http-${numericStatus || "unknown"}`);
  }

  function createCommentFetchFailure(kind, reason) {
    const error = new Error(reason);
    error.commentFetchFailure = true;
    error.kind = kind;
    error.reason = reason;
    return error;
  }

  function classifyCommentFetchFailure(error, { parentSignal, timedOut } = {}) {
    if (parentSignal?.aborted) {
      return { kind: "transient", reason: "aborted" };
    }
    if (timedOut) {
      return { kind: "transient", reason: "timeout" };
    }
    if (error?.commentFetchFailure) {
      return { kind: error.kind, reason: error.reason };
    }
    if (error?.name === "AbortError") {
      return { kind: "transient", reason: "aborted" };
    }
    return { kind: "transient", reason: "network-error" };
  }

  globalThis.TimestampPlayerCommentFetching = {
    COMMENT_FETCH_OUTCOMES,
    DEFAULT_COMMENT_FETCH_TIMEOUT_MS,
    fetchCommentRecords,
  };
})();
