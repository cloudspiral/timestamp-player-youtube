import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadCommentScoring() {
  const source = await readFile(new URL("../src/comment-scoring.js", import.meta.url), "utf8");
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return context.TimestampPlayerCommentScoring;
}

function makeTracks(starts, { titled = true } = {}) {
  return starts.map((start, index) => ({
    start,
    end: starts[index + 1] ?? 600,
    title: titled ? `Track ${index + 1}` : "",
  }));
}

function source(overrides = {}) {
  return {
    duration: 600,
    likeCount: null,
    order: 0,
    sourceType: "regular",
    tracks: makeTracks([0, 300]),
    ...overrides,
  };
}

test("parses plain, grouped, and abbreviated like counts", async () => {
  const { parseCommentLikeCount } = await loadCommentScoring();
  const cases = new Map([
    ["0", 0],
    ["42 likes", 42],
    ["1,234", 1234],
    ["1.2K likes", 1200],
    ["3.45 k", 3450],
    ["1.25M", 1250000],
    ["  Likes: 12,345  ", 12345],
  ]);

  for (const [value, expected] of cases) {
    assert.equal(parseCommentLikeCount(value), expected, value);
  }
  for (const value of ["", "No likes", "many", null]) {
    assert.equal(parseCommentLikeCount(value), null, String(value));
  }
});

test("invalid track sources cannot compete", async () => {
  const { scoreCommentTrackSource } = await loadCommentScoring();

  assert.equal(scoreCommentTrackSource(source({ tracks: [] })), Number.NEGATIVE_INFINITY);
  assert.equal(scoreCommentTrackSource(source({ duration: 0 })), Number.NEGATIVE_INFINITY);
  assert.equal(scoreCommentTrackSource(source({ duration: -1 })), Number.NEGATIVE_INFINITY);
  assert.equal(scoreCommentTrackSource(source({ duration: NaN })), Number.NEGATIVE_INFINITY);
  assert.equal(scoreCommentTrackSource({}), Number.NEGATIVE_INFINITY);
});

test("the score combines start, coverage, titles, likes, and count deterministically", async () => {
  const { scoreCommentTrackSource } = await loadCommentScoring();
  const score = scoreCommentTrackSource(source({ likeCount: 0 }));

  // 35 early-start + 22.5 coverage + 10 title coverage + 0.8 track count.
  assert.ok(Math.abs(score - 68.3) < 1e-9);
});

test("source trust applies fixed pinned and uploader bonuses", async () => {
  const { scoreCommentTrackSource } = await loadCommentScoring();
  const regular = scoreCommentTrackSource(source({ sourceType: "regular" }));
  const uploader = scoreCommentTrackSource(source({ sourceType: "uploader" }));
  const pinned = scoreCommentTrackSource(source({ sourceType: "pinned" }));
  const unknown = scoreCommentTrackSource(source({ sourceType: "unknown" }));

  assert.equal(uploader - regular, 14);
  assert.equal(pinned - regular, 20);
  assert.equal(unknown, regular);
});

test("start-score thresholds are inclusive and drop in documented steps", async () => {
  const { scoreCommentTrackSource } = await loadCommentScoring();
  const scoreAt = (start) => scoreCommentTrackSource(source({
    tracks: makeTracks([start, start + 100]),
  }));
  const assertDifference = (left, right, expected) => {
    assert.ok(Math.abs((scoreAt(left) - scoreAt(right)) - expected) < 1e-9);
  };

  assertDifference(30, 31, 10);
  assertDifference(120, 121, 15);
  assertDifference(300, 301, 10);
});

test("coverage and like contributions are bounded", async () => {
  const { scoreCommentTrackSource } = await loadCommentScoring();
  const fullCoverage = scoreCommentTrackSource(source({ tracks: makeTracks([0, 600]) }));
  const beyondDuration = scoreCommentTrackSource(source({ tracks: makeTracks([0, 1200]) }));
  assert.equal(beyondDuration, fullCoverage, "coverage should clamp at one video duration");

  const trillionLikes = scoreCommentTrackSource(source({ likeCount: 1e12 }));
  const vastlyMoreLikes = scoreCommentTrackSource(source({ likeCount: 1e30 }));
  assert.equal(vastlyMoreLikes, trillionLikes, "like contribution should cap at 30 points");
});

test("title coverage and raw track count have bounded influence", async () => {
  const { scoreCommentTrackSource } = await loadCommentScoring();
  const titled = scoreCommentTrackSource(source({ tracks: makeTracks([0, 300]) }));
  const untitled = scoreCommentTrackSource(source({ tracks: makeTracks([0, 300], { titled: false }) }));
  assert.equal(titled - untitled, 10);

  const forty = scoreCommentTrackSource(source({
    tracks: makeTracks(Array.from({ length: 40 }, () => 0), { titled: false }),
  }));
  const hundred = scoreCommentTrackSource(source({
    tracks: makeTracks(Array.from({ length: 100 }, () => 0), { titled: false }),
  }));
  assert.equal(hundred, forty, "track-count contribution should cap at 40 timestamps");
});
