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
  const {
    extractCommentRecords,
    findBestCommentContinuation,
    isSupportedContinuationResponse,
    mergeCommentRecords,
  } = globalThis.TimestampPlayerCommentData || {};

  const {
    getYouTubePageData,
    createBoundedAbortSignal,
    fetchWithSignal,
    waitForPromiseWithSignal,
    createHttpFailure,
    createCommentFetchFailure,
    classifyCommentFetchFailure,
    resolveCurrentYouTubeOrigin,
    isYouTubeHostname,
  } = globalThis.TimestampPlayerYouTubePageData;

  async function fetchCommentRecords({
    maxBatches = DEFAULT_MAX_COMMENT_BATCHES,
    loadPageData = getYouTubePageData,
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

      const pageData = await waitForPromiseWithSignal(loadPageData(videoId, boundedAbort.signal), boundedAbort.signal);
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

  globalThis.TimestampPlayerCommentFetching = {
    COMMENT_FETCH_OUTCOMES,
    DEFAULT_COMMENT_FETCH_TIMEOUT_MS,
    fetchCommentRecords,
    resolveContinuationApiUrl,
  };
})();
