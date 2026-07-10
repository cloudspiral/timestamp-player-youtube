import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadTimestamps() {
  const source = await readFile(new URL("../src/timestamps.js", import.meta.url), "utf8");
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return context.TimestampPlayerTimestamps;
}

function makeCandidates(starts, titles = []) {
  return starts.map((start, index) => ({
    start,
    timestampText: String(start),
    title: titles[index] ?? `Title ${index + 1}`,
    lineKey: `fixture:${index}`,
  }));
}

function trackSnapshot(tracks) {
  return Array.from(tracks, (track) => ({
    index: track.index,
    start: track.start,
    end: track.end,
    title: track.title,
  }));
}

function trackStarts(tracks) {
  return Array.from(tracks, (track) => track.start);
}

function assertTrackInvariants(tracks, duration) {
  for (const [index, track] of Array.from(tracks).entries()) {
    assert.equal(track.index, index, "track indexes should be contiguous");
    assert.equal(Number.isFinite(track.start), true, "track starts should be finite");
    assert.equal(Number.isFinite(track.end), true, "track ends should be finite");
    assert.equal(Object.is(track.start, -0), false, "negative zero should be normalized");
    assert.ok(track.start >= 0, "track starts should not be negative");
    assert.ok(track.start < track.end, "every track should have positive duration");
    assert.ok(track.end <= duration, "track ends should not exceed the video duration");
    if (index > 0) {
      assert.ok(tracks[index - 1].start < track.start, "track starts should increase");
    }
  }

  if (tracks.length) {
    assert.equal(tracks[tracks.length - 1].end, duration, "the final track should end at the video duration");
  }
}

test("uses nearby title lines when timestamp lines contain decorated track numbers", async () => {
  const timestamps = await loadTimestamps();
  const text = `00:00 " 01.
町中ドライブ
Downtown Drive
Manear al centro de la ciudad

O:
Desire Drive
Manejar el deseo

[   東方神霊廟　～ Ten Desires    ]
%

3:52 " 02.
春のおとずれ
The Coming of Spring
La llegada de la primavera`;

  const tracks = timestamps.findTracks(600, timestamps.getTextTimestampCandidates(text, "fixture"));

  assert.equal(tracks[0].title, "町中ドライブ");
  assert.equal(tracks[1].title, "春のおとずれ");
});

test("preserves existing timestamp title parsing behavior", async () => {
  const timestamps = await loadTimestamps();

  assert.equal(
    timestamps.findTracks(
      300,
      timestamps.getTextTimestampCandidates("00:00 01.\nFirst Song\n1:00 02.\nSecond Song", "fixture")
    )[0].title,
    "First Song"
  );
  assert.equal(timestamps.cleanTrackTitle("01. Downtown Drive"), "Downtown Drive");
  assert.equal(timestamps.titleFromLineFragment("0:00 - 0:58 Introduction", "0:00"), "Introduction");
  assert.equal(timestamps.cleanTrackTitle('"Heroes"'), '"Heroes"');
});

test("parses valid clock boundaries without treating two-part minutes as an hour field", async () => {
  const { parseTimestampText } = await loadTimestamps();
  const cases = new Map([
    ["0:00", 0],
    ["00:59", 59],
    ["59:59", 3599],
    ["60:00", 3600],
    ["1:00:00", 3600],
    ["12:59:59", 46799],
    [" 1:02 ", 62],
  ]);

  for (const [value, expected] of cases) {
    assert.equal(parseTimestampText(value), expected, value);
  }
});

test("rejects out-of-range clock fields and malformed timestamp text", async () => {
  const { parseTimestampText } = await loadTimestamps();
  const invalidValues = [
    "0:60",
    "1:99",
    "1:60:00",
    "1:00:60",
    "12:99:00",
    "-1:00",
    "1:2",
    "1:02:3",
    "100:00:00",
    "1::00",
    "",
    "not a timestamp",
    null,
    90,
  ];

  for (const value of invalidValues) {
    assert.equal(Number.isNaN(parseTimestampText(value)), true, String(value));
  }
});

test("parses only complete nonnegative YouTube time parameters", async () => {
  const { parseTimeParam } = await loadTimestamps();
  const validCases = new Map([
    ["0", 0],
    ["90", 90],
    ["90s", 90],
    ["1m30s", 90],
    ["1m90s", 150],
    ["1h2m3s", 3723],
    ["1h2m3", 3723],
    ["0.5s", 0.5],
    [" 90 ", 90],
  ]);
  const invalidValues = [
    "-1",
    "-1s",
    "1:30",
    "10junk",
    "1h2h",
    "1e3",
    ".5",
    "",
    null,
    90,
  ];

  for (const [value, expected] of validCases) {
    assert.equal(parseTimeParam(value), expected, value);
  }
  for (const value of invalidValues) {
    assert.equal(Number.isNaN(parseTimeParam(value)), true, String(value));
  }
});

test("drops invalid clock lines and suppresses malformed timestamp ranges", async () => {
  const {
    getTextTimestampCandidates,
    isTimestampRangeEndMarker,
  } = await loadTimestamps();
  const mixedCandidates = getTextTimestampCandidates(
    "1:99 Invalid clock\n2:00 First valid\n3:00 Second valid",
    "mixed"
  );

  assert.deepEqual(Array.from(mixedCandidates, (candidate) => candidate.start), [120, 180]);

  for (const line of [
    "0:00 - 0:60 Invalid end",
    "1:99 - 2:30 Invalid start",
    "3:00 - 2:00 Reversed range",
  ]) {
    assert.equal(getTextTimestampCandidates(line, "invalid-range").length, 0, line);
  }

  const validRange = getTextTimestampCandidates("0:00 - 1:00 Introduction", "valid-range");
  assert.equal(validRange.length, 1);
  assert.equal(validRange[0].start, 0);
  assert.equal(validRange[0].title, "Introduction");
  assert.equal(isTimestampRangeEndMarker("0:00 - 1:00 Introduction", "1:00"), true);
});

test("rejects invalid durations before building tracks", async () => {
  const { findTracks } = await loadTimestamps();
  const candidates = makeCandidates([0, 10]);

  for (const duration of [0, -1, NaN, Infinity]) {
    assert.equal(findTracks(duration, candidates).length, 0, String(duration));
  }
});

test("filters invalid starts before run selection and interval construction", async () => {
  const { findTracks } = await loadTimestamps();
  const cases = [
    [0, NaN, 30],
    [0, Infinity, 30],
    [0, 90, 30],
    [-1, 0, 30, 60],
  ];

  for (const starts of cases) {
    const tracks = findTracks(60, makeCandidates(starts));
    assert.deepEqual(trackStarts(tracks), [0, 30], starts.join(","));
    assertTrackInvariants(tracks, 60);
  }

  assert.equal(findTracks(60, makeCandidates([0, 60])).length, 0);
  assert.equal(findTracks(60, makeCandidates(["0", "30"])).length, 0);
});

test("builds bounded intervals while preserving titles and source order", async () => {
  const { findTracks } = await loadTimestamps();
  const tracks = findTracks(120, makeCandidates([0, 30, 90], ["Intro", "Middle", "Finale"]));

  assert.deepEqual(trackSnapshot(tracks), [
    { index: 0, start: 0, end: 29.8, title: "Intro" },
    { index: 1, start: 30, end: 89.8, title: "Middle" },
    { index: 2, start: 90, end: 120, title: "Finale" },
  ]);
  assertTrackInvariants(tracks, 120);
});

test("coalesces exact and near-duplicate boundaries using the richer title", async () => {
  const { findTracks } = await loadTimestamps();

  for (const duplicateStart of [0, 0.1, 0.2]) {
    const tracks = findTracks(
      60,
      makeCandidates([0, duplicateStart, 10], ["", "Introduction", "Finale"])
    );
    assert.deepEqual(trackStarts(tracks), [0, 10], String(duplicateStart));
    assert.equal(tracks[0].title, "Introduction");
    assertTrackInvariants(tracks, 60);
  }

  const separatedTracks = findTracks(60, makeCandidates([0, 0.5, 10]));
  assert.deepEqual(trackStarts(separatedTracks), [0, 0.5, 10]);
  assertTrackInvariants(separatedTracks, 60);
});

test("applies duration tolerance and minimum track count after normalization", async () => {
  const { findTracks } = await loadTimestamps();
  const normalizedTracks = findTracks(60, makeCandidates([-0.0000005, 30, 59.9999999]));

  assert.deepEqual(trackStarts(normalizedTracks), [0, 30]);
  assertTrackInvariants(normalizedTracks, 60);
  assert.deepEqual(trackStarts(findTracks(60, makeCandidates([-0.000002, 0, 30]))), [0, 30]);
  assert.equal(findTracks(60, makeCandidates([0, 0.1, 10]), 3).length, 0);

  const shortFinalTrack = findTracks(60, makeCandidates([0, 30, 59.9]));
  assert.deepEqual(trackStarts(shortFinalTrack), [0, 30, 59.9]);
  assertTrackInvariants(shortFinalTrack, 60);
});

test("preserves increasing-run selection without globally sorting candidates", async () => {
  const { findTracks } = await loadTimestamps();

  assert.deepEqual(trackStarts(findTracks(60, makeCandidates([0, 30, 10, 20]))), [0, 30]);
  assert.deepEqual(trackStarts(findTracks(300, makeCandidates([180, 240]))), [180, 240]);
  assert.equal(findTracks(300, makeCandidates([180, 240, 150, 210])).length, 0);
});

test("every emitted track set satisfies the duration and ordering invariants", async () => {
  const { findTracks } = await loadTimestamps();
  const cases = [
    { duration: 60, starts: [0, 30, 90] },
    { duration: 60, starts: [-5, 0, 15] },
    { duration: 60, starts: [0, 0.1, 10] },
    { duration: 60, starts: [NaN, 0, Infinity, 15, 60] },
    { duration: 60, starts: [0.5, 20.75, 59.9] },
    { duration: 300, starts: [180, 240] },
  ];

  for (const { duration, starts } of cases) {
    assertTrackInvariants(findTracks(duration, makeCandidates(starts)), duration);
  }
});
