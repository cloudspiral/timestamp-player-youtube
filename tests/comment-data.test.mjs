import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const fixtureUrl = (name) => new URL(`./fixtures/comments/${name}.json`, import.meta.url);

async function readJsonFixture(name) {
  return JSON.parse(await readFile(fixtureUrl(name), "utf8"));
}

async function loadCommentData() {
  const [commentDataSource, commentScoringSource] = await Promise.all([
    readFile(new URL("../src/comment-data.js", import.meta.url), "utf8"),
    readFile(new URL("../src/comment-scoring.js", import.meta.url), "utf8"),
  ]);
  const context = vm.createContext({});
  vm.runInContext(commentScoringSource, context);
  vm.runInContext(commentDataSource, context);
  return context.TimestampPlayerCommentData;
}

test("merges textless stable-key metadata before dropping final textless groups", async () => {
  const runtime = await loadCommentData();
  const response = await readJsonFixture("metadata-fragments-and-lookalikes");

  const records = Array.from(runtime.extractCommentRecords(response));

  assert.equal(records.length, 3);
  const enriched = records.find(({ commentId }) => commentId === "fragment-comment");
  assert.ok(enriched);
  assert.deepEqual(Array.from(enriched.commentKeys), ["entity-fragment-comment"]);
  assert.equal(enriched.text, "0:00 Opening\n1:20 Details");
  assert.equal(enriched.authorName, "Fixture Uploader");
  assert.equal(enriched.authorChannelId, "UC-fixture-uploader");
  assert.equal(enriched.isUploader, true);
  assert.equal(enriched.likeCount, 37);
  assert.equal(
    records.some(({ commentId }) => commentId === "orphan-textless-comment"),
    false,
    "an unmatched textless metadata group is not a comment record"
  );
});

test("keeps identifier-free author and body lookalikes as distinct records", async () => {
  const runtime = await loadCommentData();
  const response = await readJsonFixture("metadata-fragments-and-lookalikes");

  const lookalikes = Array.from(runtime.extractCommentRecords(response)).filter(
    ({ authorName }) => authorName === "Lookalike Author"
  );

  assert.equal(lookalikes.length, 2);
  assert.ok(lookalikes.every(({ commentId, commentKeys }) => {
    return commentId === "" && Array.from(commentKeys).length === 0;
  }));
  assert.deepEqual(lookalikes.map(({ likeCount }) => likeCount), [1, 9]);
});

test("selects comment continuations and recognizes supported payload envelopes", async () => {
  const runtime = await loadCommentData();
  const initialPage = await readJsonFixture("initial-page");
  const nextBatch = await readJsonFixture("batch-with-continuation");

  const initial = runtime.findBestCommentContinuation(initialPage.initialData, {
    phase: "initial",
  });
  assert.equal(initial.token, "comments-batch-1");
  assert.equal(initial.apiUrl, "/youtubei/v1/next");

  const next = runtime.findBestCommentContinuation(nextBatch, {
    phase: "next",
  });
  assert.equal(next.token, "comments-batch-2");
  assert.equal(
    runtime.findBestCommentContinuation(nextBatch, {
      phase: "next",
      seenTokens: new Set(["comments-batch-2"]),
    }),
    null
  );

  assert.equal(runtime.isSupportedContinuationResponse(nextBatch), true);
  assert.equal(runtime.isSupportedContinuationResponse({}), false);
  assert.equal(runtime.isSupportedContinuationResponse([]), false);
});

test("runtime trusts only structural uploader metadata for fetched comments", async () => {
  const contentSource = await readFile(
    new URL("../src/fetched-comment-sources.js", import.meta.url),
    "utf8"
  );
  const sourceTypeFunction = contentSource.match(
    /function getFetchedCommentSourceType\(record\) \{[\s\S]*?\n  \}/
  )?.[0] || "";

  assert.match(sourceTypeFunction, /record\?\.isUploader/);
  assert.doesNotMatch(sourceTypeFunction, /authorName|channelName|videoOwner/i);
});
