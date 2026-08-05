(() => {
  const DEFAULT_MAX_COMMENT_BATCHES = 3;
  const DEFAULT_COMMENT_FETCH_TIMEOUT_MS = 10000;
  const DEFAULT_NEXT_API_PATH = "/youtubei/v1/next";
  const SUPPORTED_YOUTUBE_HOSTNAMES = new Set([
    "youtube.com",
    "www.youtube.com",
    "music.youtube.com",
  ]);
  const COMMENT_FETCH_OUTCOMES = Object.freeze({
    SUCCESS: "success",
    PARTIAL: "partial",
    NO_RESULTS: "no-results",
    TRANSIENT_ERROR: "transient-error",
    UNSUPPORTED: "unsupported",
    ABORTED: "aborted",
  });
  const {
    extractCommentRecords,
    findBestCommentContinuation,
    isSupportedContinuationResponse,
    mergeCommentRecords,
  } = globalThis.TimestampPlayerCommentData || {};

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
        const mergedRecords = mergeCommentRecords(records, batchRecords);
        records.splice(
          0,
          records.length,
          ...mergedRecords.map((record, order) => ({ ...record, order }))
        );

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
        retryable: failure.reason !== "aborted"
          && failure.reason !== "unsafe-continuation-api-url"
          && failure.reason !== "unsafe-watch-page-url"
          && !signal?.aborted,
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
    const url = resolveWatchPageUrl(videoId);
    const response = await fetchWithSignal(url.toString(), {
      credentials: "include",
      redirect: "error",
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

  function resolveWatchPageUrl(videoId) {
    const currentOrigin = resolveCurrentYouTubeOrigin("unsafe-watch-page-url");
    const url = new URL("/watch", `${currentOrigin.origin}/`);
    url.searchParams.set("v", videoId);
    return url;
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

  async function fetchContinuation(config, continuation, signal) {
    const url = resolveContinuationApiUrl(
      continuation.apiUrl || DEFAULT_NEXT_API_PATH
    );
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
      redirect: "error",
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

  function resolveContinuationApiUrl(apiUrl) {
    const rawApiUrl = typeof apiUrl === "string" ? apiUrl.trim() : "";
    if (!rawApiUrl || rawApiUrl.includes("\\") || /^[\\/]{2}/.test(rawApiUrl)) {
      throw createCommentFetchFailure("unsupported", "unsafe-continuation-api-url");
    }

    const currentOrigin = resolveCurrentYouTubeOrigin("unsafe-continuation-api-url");
    let url;
    try {
      url = new URL(rawApiUrl, `${currentOrigin.origin}/`);
    } catch (_error) {
      throw createCommentFetchFailure("unsupported", "unsafe-continuation-api-url");
    }

    if (
      currentOrigin.protocol !== "https:"
      || !isYouTubeHostname(currentOrigin.hostname)
      || url.protocol !== "https:"
      || url.origin !== currentOrigin.origin
      || url.username
      || url.password
      || !url.pathname.startsWith("/youtubei/")
    ) {
      throw createCommentFetchFailure("unsupported", "unsafe-continuation-api-url");
    }
    return url;
  }

  function resolveCurrentYouTubeOrigin(failureReason) {
    let currentOrigin;
    let rawOrigin;
    try {
      rawOrigin = String(globalThis.location?.origin || "");
      currentOrigin = new URL(rawOrigin);
    } catch (_error) {
      throw createCommentFetchFailure("unsupported", failureReason);
    }

    if (
      currentOrigin.protocol !== "https:"
      || !isYouTubeHostname(currentOrigin.hostname)
      || currentOrigin.port
      || currentOrigin.username
      || currentOrigin.password
      || currentOrigin.origin !== rawOrigin
    ) {
      throw createCommentFetchFailure("unsupported", failureReason);
    }
    return currentOrigin;
  }

  function isYouTubeHostname(hostname) {
    const normalizedHostname = String(hostname || "").toLowerCase();
    return SUPPORTED_YOUTUBE_HOSTNAMES.has(normalizedHostname);
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
    resolveContinuationApiUrl,
  };
})();
