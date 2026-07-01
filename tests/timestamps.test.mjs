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
