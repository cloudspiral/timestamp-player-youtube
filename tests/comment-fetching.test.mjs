import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const fixtureUrl = (name) => new URL(`./fixtures/comments/${name}.json`, import.meta.url);

async function readJsonFixture(name) {
  return JSON.parse(await readFile(fixtureUrl(name), "utf8"));
}

async function loadCommentFetching({ fetchImpl, pageFixture } = {}) {
  const [commentDataSource, commentFetchingSource, commentScoringSource] = await Promise.all([
    readFile(new URL("../src/comment-data.js", import.meta.url), "utf8"),
    readFile(new URL("../src/comment-fetching.js", import.meta.url), "utf8"),
    readFile(new URL("../src/comment-scoring.js", import.meta.url), "utf8"),
  ]);
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
  });
  vm.runInContext(commentScoringSource, context);
  vm.runInContext(commentDataSource, context);
  vm.runInContext(commentFetchingSource, context);
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


test("extracts only schema-backed metadata and merges richer duplicates across batches", async () => {
  const firstBatch = await readJsonFixture("metadata-batch-with-continuation");
  const finalBatch = await readJsonFixture("metadata-batch-final");
  let requestCount = 0;
  const runtime = await loadCommentFetching({
    fetchImpl: async () => {
      requestCount += 1;
      return jsonResponse(requestCount === 1 ? firstBatch : finalBatch);
    },
  });

  const result = await runtime.fetchCommentRecords({ videoId: "fixture-video" });

  assert.equal(result.status, runtime.COMMENT_FETCH_OUTCOMES.SUCCESS);
  assert.equal(result.batchesFetched, 2);
  assert.equal(result.records.length, 8);
  assert.deepEqual(Array.from(result.records, ({ order }) => order), [0, 1, 2, 3, 4, 5, 6, 7]);

  const recordsById = new Map(result.records.map((record) => [record.commentId, record]));
  const modern = recordsById.get("modern-comment");
  assert.ok(modern, "the nested viewmodel and entity payload should produce one record");
  assert.deepEqual(Array.from(modern.commentKeys), ["entity-modern-comment"]);
  assert.equal(modern.text, "0:00 Intro\n1:00 Middle\n2:00 Finale\n3:00 Bonus");
  assert.equal(modern.authorName, "Modern Author");
  assert.equal(modern.authorChannelId, "UC-modern-author");
  assert.equal(modern.isPinned, true, "pinnedText is structural pin evidence");
  assert.equal(modern.isUploader, true, "the entity creator flag enriches the viewmodel");
  assert.equal(modern.likeCount, 25, "semantic like fields merge without summing");
  assert.equal(modern.order, 0, "a duplicate keeps its first-seen position");

  const unsafe = recordsById.get("unsafe-metadata-comment");
  assert.ok(unsafe);
  assert.equal(unsafe.isPinned, false, "body text mentioning a pin is not pin evidence");
  assert.equal(unsafe.isUploader, false, "string lookalikes are not creator booleans");
  assert.equal(
    unsafe.likeCount,
    null,
    "reply counts, dates, tooltips, tracking IDs, and nested labels are not likes"
  );

  const sameTextRecords = Array.from(result.records).filter(({ commentId }) => {
    return commentId === "same-text-a" || commentId === "same-text-b";
  });
  assert.deepEqual(
    sameTextRecords.map(({ commentId }) => commentId),
    ["same-text-a", "same-text-b"],
    "distinct IDs must survive even when author and body are identical"
  );

  const identifierFree = Array.from(result.records).filter(
    ({ authorName }) => authorName === "Legacy Author"
  );
  assert.equal(identifierFree.length, 2, "ID-free lookalikes must remain distinct records");
  assert.ok(identifierFree.every(({ commentId }) => commentId === ""));
  assert.deepEqual(identifierFree.map(({ likeCount }) => likeCount), [2, 9]);

  const structuralRenderer = recordsById.get("structural-renderer-comment");
  assert.ok(structuralRenderer);
  assert.equal(structuralRenderer.authorChannelId, "UC-fixture-channel");
  assert.equal(structuralRenderer.isPinned, true);
  assert.equal(structuralRenderer.isUploader, true);
  assert.equal(structuralRenderer.likeCount, 1200);

  const keyOnlyPinnedEntity = recordsById.get("key-only-pinned-comment");
  assert.ok(keyOnlyPinnedEntity);
  assert.deepEqual(
    Array.from(keyOnlyPinnedEntity.commentKeys),
    ["entity-key-only-pinned-comment"]
  );
  assert.equal(
    keyOnlyPinnedEntity.isPinned,
    true,
    "a textless pinned viewmodel should mark its entity through the enclosing entityKey"
  );
  assert.equal(keyOnlyPinnedEntity.isUploader, false);
  assert.equal(keyOnlyPinnedEntity.likeCount, 8);
});

test("does not treat false, null, or empty pin fields as structural evidence", async () => {
  const response = {
    onResponseReceivedEndpoints: [{
      appendContinuationItemsAction: {
        continuationItems: [
          {
            commentRenderer: {
              commentId: "false-renderer-badge",
              contentText: { simpleText: "Renderer with a false badge" },
              authorText: { simpleText: "Fixture Author" },
              pinnedCommentBadge: false,
            },
          },
          {
            commentViewModel: {
              commentViewModel: {
                commentId: "false-viewmodel-text",
                content: { content: "Viewmodel with false pinned text" },
                pinnedText: false,
              },
            },
          },
          {
            commentViewModel: {
              commentViewModel: {
                commentId: "empty-viewmodel-text",
                content: { content: "Viewmodel with empty pinned text" },
                pinnedText: "",
              },
            },
          },
          {
            commentViewModel: {
              commentViewModel: {
                commentId: "empty-viewmodel-badge",
                content: { content: "Viewmodel with an empty badge" },
                pinnedText: null,
                pinnedCommentBadge: {},
              },
            },
          },
          {
            commentViewModel: {
              commentViewModel: {
                commentId: "empty-viewmodel-text-object",
                content: { content: "Viewmodel with an empty pinned text object" },
                pinnedText: { content: "" },
              },
            },
          },
        ],
      },
    }],
  };
  const runtime = await loadCommentFetching({
    fetchImpl: async () => jsonResponse(response),
  });

  const result = await runtime.fetchCommentRecords({ videoId: "fixture-video" });

  assert.equal(result.status, runtime.COMMENT_FETCH_OUTCOMES.SUCCESS);
  assert.equal(result.records.length, 5);
  assert.ok(Array.from(result.records).every(({ isPinned }) => isPinned === false));
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
