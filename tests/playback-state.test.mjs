import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadPlaybackState() {
  const source = await readFile(new URL("../src/playback-state.js", import.meta.url), "utf8");
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return context.TimestampPlayerPlaybackState;
}

function plain(value) {
  return structuredClone(value);
}

test("creates isolated default playback state", async () => {
  const api = await loadPlaybackState();
  const first = api.createPlaybackState();
  const second = api.createPlaybackState();

  assert.deepEqual(plain(first), {
    history: [],
    repeatMode: api.REPEAT_MODES.OFF,
    shuffleEnabled: false,
    upcoming: [],
  });
  assert.notEqual(first.history, second.history);
  assert.notEqual(first.upcoming, second.upcoming);
});

test("clearing playback order preserves shuffle and repeat modes without mutating input", async () => {
  const api = await loadPlaybackState();
  const state = api.createPlaybackState({
    history: [0, 1],
    repeatMode: api.REPEAT_MODES.ONE,
    shuffleEnabled: true,
    upcoming: [2, 3],
  });
  const cleared = api.clearPlaybackOrder(state);

  assert.deepEqual(plain(cleared), {
    history: [],
    repeatMode: api.REPEAT_MODES.ONE,
    shuffleEnabled: true,
    upcoming: [],
  });
  assert.deepEqual(plain(state.history), [0, 1]);
  assert.deepEqual(plain(state.upcoming), [2, 3]);
});

test("shuffle toggling preserves the existing asymmetric reset behavior", async () => {
  const api = await loadPlaybackState();
  const original = api.createPlaybackState({ history: [0], upcoming: [2] });

  const unavailable = api.toggleShuffle(original, 1);
  assert.equal(unavailable.shuffleEnabled, false);
  assert.deepEqual(plain(unavailable.history), [0]);
  assert.deepEqual(plain(unavailable.upcoming), []);

  const enabled = api.toggleShuffle(original, 3);
  assert.equal(enabled.shuffleEnabled, true);
  assert.deepEqual(plain(enabled.history), []);
  assert.deepEqual(plain(enabled.upcoming), []);

  const withOrder = api.createPlaybackState({
    history: [0, 1],
    shuffleEnabled: true,
    upcoming: [2],
  });
  const disabled = api.toggleShuffle(withOrder, 3);
  assert.equal(disabled.shuffleEnabled, false);
  assert.deepEqual(plain(disabled.history), [0, 1], "turning shuffle off keeps history");
  assert.deepEqual(plain(disabled.upcoming), []);
});

test("repeat toggles one/off, rejects stale modes, and remains off without playable tracks", async () => {
  const api = await loadPlaybackState();
  const off = api.createPlaybackState();
  const one = api.toggleRepeat(off, 3);

  assert.equal(one.repeatMode, api.REPEAT_MODES.ONE);
  assert.equal(api.toggleRepeat(one, 3).repeatMode, api.REPEAT_MODES.OFF);
  assert.equal(api.toggleRepeat(off, 1).repeatMode, api.REPEAT_MODES.OFF);
  assert.equal(api.createPlaybackState({ repeatMode: "all" }).repeatMode, api.REPEAT_MODES.OFF);
});

test("public sequential selection preserves next and previous boundary behavior", async () => {
  const api = await loadPlaybackState();
  const state = api.createPlaybackState();

  assert.equal(api.selectNextTrack(state, {
    currentIndex: 1,
    trackCount: 3,
    tracksAvailable: false,
  }).index, -1);
  assert.equal(api.selectNextTrack(state, {
    currentIndex: -1,
    trackCount: 3,
    tracksAvailable: true,
  }).index, 0);
  assert.equal(api.selectNextTrack(state, {
    currentIndex: 2,
    trackCount: 3,
    tracksAvailable: true,
  }).index, 0);
  assert.equal(api.selectPreviousTrack(state, {
    currentIndex: 2,
    trackCount: 3,
    tracksAvailable: true,
  }).index, 1);
  assert.equal(api.selectPreviousTrack(state, {
    currentIndex: 0,
    trackCount: 3,
    tracksAvailable: true,
  }).index, 0);
  assert.equal(api.selectPreviousTrack(state, {
    currentIndex: 0,
    trackCount: 3,
    tracksAvailable: false,
  }).index, -1);
});

test("shuffle refill is deterministic, excludes current, and consumes one cycle", async () => {
  const api = await loadPlaybackState();
  let state = api.createPlaybackState({ shuffleEnabled: true });
  const randomValues = [0, 0.9];
  const random = () => randomValues.shift();

  let selection = api.selectNextTrack(state, {
    currentIndex: 1,
    random,
    trackCount: 4,
    tracksAvailable: true,
  });
  state = selection.state;
  assert.equal(selection.index, 3);
  assert.deepEqual(plain(state.upcoming), [2, 0]);

  selection = api.selectNextTrack(state, {
    currentIndex: 3,
    random: () => {
      throw new Error("a nonempty queue must not reshuffle");
    },
    trackCount: 4,
    tracksAvailable: true,
  });
  assert.equal(selection.index, 2);
  assert.deepEqual(plain(selection.state.upcoming), [0]);
});

test("shuffle discards invalid and current queue heads before selecting", async () => {
  const api = await loadPlaybackState();
  const state = api.createPlaybackState({
    shuffleEnabled: true,
    upcoming: [99, 1, 2, 0],
  });
  const selection = api.selectNextTrack(state, {
    currentIndex: 1,
    random: () => {
      throw new Error("valid remaining queue entries must be reused");
    },
    trackCount: 3,
    tracksAvailable: true,
  });

  assert.equal(selection.index, 2);
  assert.deepEqual(plain(selection.state.upcoming), [0]);
});

test("history records valid changes, removes selected upcoming tracks, and caps at 100", async () => {
  const api = await loadPlaybackState();
  let state = api.createPlaybackState({ upcoming: [1, 2, 3] });

  state = api.recordTrackSelection(state, {
    nextIndex: 2,
    previousIndex: 0,
    trackCount: 4,
  });
  assert.deepEqual(plain(state.history), [0]);
  assert.deepEqual(plain(state.upcoming), [1, 3]);

  state = api.recordTrackSelection(state, {
    nextIndex: 1,
    previousIndex: 1,
    trackCount: 4,
  });
  state = api.recordTrackSelection(state, {
    nextIndex: 1,
    previousIndex: 99,
    trackCount: 4,
  });
  assert.deepEqual(plain(state.history), [0]);

  for (let index = 0; index < 105; index += 1) {
    state = api.recordTrackSelection(state, {
      nextIndex: (index + 1) % 4,
      previousIndex: index % 4,
      trackCount: 4,
    });
  }
  assert.equal(state.history.length, 100);
  assert.deepEqual(plain(state.history.slice(-4)), [1, 2, 3, 0]);
});

test("keeps playback implementation details private", async () => {
  const api = await loadPlaybackState();

  for (const name of [
    "MAX_HISTORY_LENGTH",
    "getNextSequentialTrackIndex",
    "getPreviousSequentialTrackIndex",
    "queueTrackNext",
    "resetPlaybackState",
  ]) {
    assert.equal(Object.hasOwn(api, name), false, `${name} should remain internal`);
  }
});

test("recordHistory false still removes a manually selected track from upcoming", async () => {
  const api = await loadPlaybackState();
  const state = api.createPlaybackState({ history: [0], upcoming: [1, 2] });
  const next = api.recordTrackSelection(state, {
    nextIndex: 1,
    previousIndex: 0,
    recordHistory: false,
    trackCount: 3,
  });

  assert.deepEqual(plain(next.history), [0]);
  assert.deepEqual(plain(next.upcoming), [2]);
});

test("shuffle previous pops history and queues the abandoned current track next", async () => {
  const api = await loadPlaybackState();
  const state = api.createPlaybackState({
    history: [0, 2],
    shuffleEnabled: true,
    upcoming: [1, 3, 1],
  });
  const selection = api.selectPreviousTrack(state, {
    currentIndex: 1,
    trackCount: 4,
    tracksAvailable: true,
  });

  assert.equal(selection.index, 2);
  assert.deepEqual(plain(selection.state.history), [0]);
  assert.deepEqual(plain(selection.state.upcoming), [1, 3]);

  const noHistory = api.selectPreviousTrack(
    api.createPlaybackState({ shuffleEnabled: true, upcoming: [2] }),
    { currentIndex: 1, trackCount: 3, tracksAvailable: true }
  );
  assert.equal(noHistory.index, 1);
  assert.deepEqual(plain(noHistory.state.upcoming), [2]);
});

test("manifest loads playback state before content orchestration", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const scripts = manifest.content_scripts[0].js;

  assert.ok(scripts.includes("src/playback-state.js"));
  assert.ok(
    scripts.indexOf("src/playback-state.js") < scripts.indexOf("src/content.js"),
    "playback state must load before content orchestration"
  );
});
