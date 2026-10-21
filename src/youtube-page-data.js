(() => {
  const SUPPORTED_YOUTUBE_HOSTNAMES = new Set([
    "youtube.com",
    "www.youtube.com",
    "music.youtube.com",
  ]);

  function createPageDataLoader(videoId, signal, { timeoutMs = 10000 } = {}) {
    let documentScripts = null;
    let documentData = null;
    let fetched = null;
    let attempt = 0;

    function readDocument() {
      const scripts = getDocumentScriptTexts();
      if (!documentScripts || scripts.length !== documentScripts.length
        || scripts.some((text, index) => text !== documentScripts[index])) {
        documentScripts = scripts;
        documentData = getYouTubePageDataFromScripts(scripts, videoId);
      }
      return pageDataMatchesVideo(documentData?.initialData, videoId) ? documentData : null;
    }

    function fetchPage() {
      if (!fetched && attempt < 2 && !signal.aborted) {
        attempt += 1;
        fetched = fetchAttempt();
      }
      return fetched || Promise.reject(createCommentFetchFailure("unsupported", "page-fetch-exhausted"));
    }

    async function fetchAttempt() {
      const bounded = createBoundedAbortSignal(signal, timeoutMs);
      try {
        const page = await fetchWatchPageData(videoId, bounded.signal);
        if (!pageDataMatchesVideo(page.initialData, videoId)) {
          throw createCommentFetchFailure("unsupported", "stale-watch-page-data");
        }
        return page;
      } catch (error) {
        const failure = classifyCommentFetchFailure(error, { parentSignal: signal, timedOut: bounded.timedOut() });
        throw createCommentFetchFailure(failure.kind, failure.reason);
      } finally {
        bounded.cleanup();
      }
    }

    function retryTransient() {
      if (attempt < 2) {
        fetched = null;
      }
    }

    return {
      readDocument,
      fetchPage,
      retryTransient,
      load: () => readDocument() || fetchPage(),
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

  function getYouTubePageDataFromScripts(scriptTexts, videoId = "") {
    return {
      config: getYouTubeConfig(scriptTexts),
      initialData: getYouTubeInitialData(scriptTexts, videoId),
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
    return getYouTubePageDataFromScripts(extractScriptTextsFromHtml(html), videoId);
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

  function getYouTubeInitialData(scriptTexts, videoId) {
    const markers = [
      "var ytInitialData =",
      "window[\"ytInitialData\"] =",
      "window['ytInitialData'] =",
      "ytInitialData =",
    ];

    for (const script of [...scriptTexts].reverse()) {
      for (const marker of markers) {
        const markerIndex = script.indexOf(marker);
        if (markerIndex === -1) {
          continue;
        }

        const parsed = parseJsonObjectAfter(script, markerIndex + marker.length);
        if (parsed && (!videoId || pageDataMatchesVideo(parsed.value, videoId))) {
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

  globalThis.TimestampPlayerYouTubePageData = {
    createPageDataLoader,
    getYouTubePageData,
    getYouTubePageDataFromScripts,
    fetchWatchPageData,
    pageDataMatchesVideo,
    getDocumentScriptTexts,
    createBoundedAbortSignal,
    fetchWithSignal,
    waitForPromiseWithSignal,
    createHttpFailure,
    createCommentFetchFailure,
    classifyCommentFetchFailure,
    resolveCurrentYouTubeOrigin,
    isYouTubeHostname,
  };
})();
