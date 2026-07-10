import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const fixtureUrl = (name) => new URL(`./fixtures/comments/${name}.json`, import.meta.url);

async function readJsonFixture(name) {
  return JSON.parse(await readFile(fixtureUrl(name), "utf8"));
}

async function loadCommentFetching({ fetchImpl, pageFixture } = {}) {
  const source = await readFile(new URL("../src/comment-fetching.js", import.meta.url), "utf8");
  const fixture = pageFixture || await readJsonFixture("initial-page");
  const scriptText = [
    `ytcfg.set(${JSON.stringify(fixture.config)});`,
    `var ytInitialData = ${JSON.stringify(fixture.initialData)};`,
  ].join("\n");
  const context = vm.createContext({
    AbortController,
    URL,
    clearTimeout,
    document: {
      scripts: [{ textContent: scriptText }],
    },
    fetch: fetchImpl || (() => {
      throw new Error("Unexpected fixture fetch");
    }),
    location: {
      href: "https://www.youtube.com/watch?v=fixture-video",
      origin: "https://www.youtube.com",
    },
    setTimeout,
    TimestampPlayerCommentScoring: {
      parseCommentLikeCount(value) {
        const parsed = Number(String(value).replace(/[^\d]/g, ""));
        return Number.isFinite(parsed) ? parsed : null;
      },
    },
  });
  vm.runInContext(source, context);
  return context.TimestampPlayerCommentFetching;
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  };
}

function htmlResponse(html, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async text() {
      return html;
    },
  };
}

test("fetches paginated comments and reports a typed success outcome", async () => {
  const firstBatch = await readJsonFixture("batch-with-continuation");
  const finalBatch = await readJsonFixture("batch-final");
  const requests = [];
  const { COMMENT_FETCH_OUTCOMES, fetchCommentRecords } = await loadCommentFetching({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse(requests.length === 1 ? firstBatch : finalBatch);
    },
  });

  const result = await fetchCommentRecords({ videoId: "fixture-video" });

  assert.equal(result.status, COMMENT_FETCH_OUTCOMES.SUCCESS);
  assert.equal(result.batchesFetched, 2);
  assert.equal(result.reason, "");
  assert.equal(result.retryable, false);
  assert.deepEqual(
    Array.from(result.records, ({ authorName, order }) => ({ authorName, order })),
    [
      { authorName: "Fixture Listener", order: 0 },
      { authorName: "Another Listener", order: 1 },
    ]
  );
  assert.equal(requests.length, 2);
  assert.equal(JSON.parse(requests[0].options.body).continuation, "comments-batch-1");
  assert.equal(JSON.parse(requests[1].options.body).continuation, "comments-batch-2");
  assert.ok(requests.every(({ options }) => options.signal instanceof AbortSignal));
});

test("passes one bounded signal through stale watch-page hydration and continuation fetches", async () => {
  const matchingPage = await readJsonFixture("initial-page");
  const stalePage = await readJsonFixture("initial-page");
  const emptyBatch = await readJsonFixture("batch-empty");
  stalePage.initialData.currentVideoEndpoint.watchEndpoint.videoId = "stale-video";
  const hydratedHtml = [
    `<script>ytcfg.set(${JSON.stringify(matchingPage.config)});</script>`,
    `<script>var ytInitialData = ${JSON.stringify(matchingPage.initialData)};</script>`,
  ].join("");
  const requests = [];
  const runtime = await loadCommentFetching({
    pageFixture: stalePage,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return requests.length === 1
        ? htmlResponse(hydratedHtml)
        : jsonResponse(emptyBatch);
    },
  });

  const result = await runtime.fetchCommentRecords({ videoId: "fixture-video" });

  assert.equal(result.status, runtime.COMMENT_FETCH_OUTCOMES.NO_RESULTS);
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /\/watch\?v=fixture-video$/);
  assert.match(requests[1].url, /\/youtubei\/v1\/next/);
  assert.equal(requests[0].options.signal, requests[1].options.signal);
});

test("preserves earlier batches when a later continuation fails", async () => {
  const firstBatch = await readJsonFixture("batch-with-continuation");
  let requestCount = 0;
  const { COMMENT_FETCH_OUTCOMES, fetchCommentRecords } = await loadCommentFetching({
    fetchImpl: async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return jsonResponse(firstBatch);
      }
      throw new TypeError("fixture network failure");
    },
  });

  const result = await fetchCommentRecords({ videoId: "fixture-video" });

  assert.equal(result.status, COMMENT_FETCH_OUTCOMES.PARTIAL);
  assert.equal(result.reason, "network-error");
  assert.equal(result.retryable, true);
  assert.equal(result.batchesFetched, 1);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].authorName, "Fixture Listener");
});

test("bounds a hung request and exposes a retryable timeout outcome", async () => {
  let requestSignal;
  const { COMMENT_FETCH_OUTCOMES, fetchCommentRecords } = await loadCommentFetching({
    fetchImpl: (_url, options) => {
      requestSignal = options.signal;
      return new Promise(() => {});
    },
  });

  const result = await fetchCommentRecords({
    timeoutMs: 10,
    videoId: "fixture-video",
  });

  assert.equal(result.status, COMMENT_FETCH_OUTCOMES.TRANSIENT_ERROR);
  assert.equal(result.reason, "timeout");
  assert.equal(result.retryable, true);
  assert.equal(requestSignal.aborted, true);
});

test("propagates navigation cancellation without making it retryable", async () => {
  const controller = new AbortController();
  let requestSignal;
  const { COMMENT_FETCH_OUTCOMES, fetchCommentRecords } = await loadCommentFetching({
    fetchImpl: (_url, options) => {
      requestSignal = options.signal;
      return new Promise(() => {});
    },
  });

  const pendingResult = fetchCommentRecords({
    signal: controller.signal,
    timeoutMs: 1000,
    videoId: "fixture-video",
  });
  await Promise.resolve();
  controller.abort("watch-session-ended");
  const result = await pendingResult;

  assert.equal(result.status, COMMENT_FETCH_OUTCOMES.ABORTED);
  assert.equal(result.reason, "aborted");
  assert.equal(result.retryable, false);
  assert.equal(requestSignal.aborted, true);
});

test("distinguishes a valid empty comment source from unsupported page data", async () => {
  const emptyBatch = await readJsonFixture("batch-empty");
  let emptyPageFetches = 0;
  const emptyRuntime = await loadCommentFetching({
    fetchImpl: async () => {
      emptyPageFetches += 1;
      return jsonResponse(emptyBatch);
    },
  });
  const emptyResult = await emptyRuntime.fetchCommentRecords({ videoId: "fixture-video" });

  const unsupportedPage = await readJsonFixture("initial-page");
  delete unsupportedPage.initialData.contents.commentsSection;
  const unsupportedRuntime = await loadCommentFetching({ pageFixture: unsupportedPage });
  const unsupportedResult = await unsupportedRuntime.fetchCommentRecords({ videoId: "fixture-video" });

  assert.equal(emptyResult.status, emptyRuntime.COMMENT_FETCH_OUTCOMES.NO_RESULTS);
  assert.equal(emptyResult.retryable, false);
  assert.equal(emptyPageFetches, 1);
  assert.equal(unsupportedResult.status, unsupportedRuntime.COMMENT_FETCH_OUTCOMES.UNSUPPORTED);
  assert.equal(unsupportedResult.reason, "missing-comment-continuation");
  assert.equal(unsupportedResult.retryable, true);
});

test("visible DOM comments and native moments are not gated on the network fetch", async () => {
  const source = await readFile(new URL("../src/content.js", import.meta.url), "utf8");
  const domScanIndex = source.indexOf("getDomCommentSourceResults(session");
  const fetchStartIndex = source.indexOf("const fetchedCommentDiscovery = getFetchedCommentDiscoveryForSession");
  const nativeScanIndex = source.indexOf("const nativeResult = getNativeSourceResult");

  assert.ok(domScanIndex >= 0, "the synchronous DOM comment scan should remain in discovery");
  assert.ok(domScanIndex < fetchStartIndex, "visible comments should be checked before network discovery starts");
  assert.ok(nativeScanIndex > fetchStartIndex, "native discovery should remain a synchronous fallback while fetch is pending");
  assert.doesNotMatch(source, /commentFetchPending|tracksLocked|shouldLockSessionTracks/);
  assert.match(source, /TRACK_SOURCE_STATUSES\.PROVISIONAL/);
  assert.match(source, /session\.trackSelection\.current/);
});
