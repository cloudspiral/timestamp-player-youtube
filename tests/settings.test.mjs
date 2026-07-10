import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadSettings(globals = {}) {
  const source = await readFile(new URL("../src/settings.js", import.meta.url), "utf8");
  const context = vm.createContext({ ...globals });
  vm.runInContext(source, context);
  return context.TimestampPlayerSettings;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadStoredSettings(api) {
  return new Promise((resolve) => api.loadSettings(resolve));
}

function saveStoredSettings(api, partialSettings) {
  return new Promise((resolve) => api.saveSettings(partialSettings, resolve));
}

function createChangeEvent() {
  const listeners = new Set();
  return {
    addListener(listener) {
      listeners.add(listener);
    },
    dispatch(changes, areaName) {
      for (const listener of listeners) {
        listener(changes, areaName);
      }
    },
    listenerCount() {
      return listeners.size;
    },
    removeListener(listener) {
      listeners.delete(listener);
    },
  };
}

test("defines progress-time values once and derives option metadata from them", async () => {
  const api = await loadSettings();

  assert.deepEqual(plain(api.PROGRESS_TIME_MODE_VALUES), {
    DURATION: "duration",
    REMAINING: "remaining",
  });
  assert.deepEqual(
    Object.keys(api.PROGRESS_TIME_MODES).sort(),
    Object.values(api.PROGRESS_TIME_MODE_VALUES).sort()
  );
  assert.equal(api.DEFAULT_SETTINGS.progressTimeMode, api.PROGRESS_TIME_MODE_VALUES.DURATION);
  assert.equal(Object.isFrozen(api.PROGRESS_TIME_MODE_VALUES), true);
  assert.equal(Object.isFrozen(api.PROGRESS_TIME_MODES), true);
});

test("normalizes enums, colors, booleans, and persisted geometry", async () => {
  const api = await loadSettings();
  const input = {
    autoShowCompact: true,
    compactProgressColor: "custom",
    compactProgressCustomColor: "#A1B2C3",
    compactProgressStyle: "normal",
    floatingPlayerPosition: { left: 10.4, top: 20.6 },
    floatingPlayerSize: { width: 400.4, height: 240.6 },
    progressColor: "green",
    progressCustomColor: "#ABCDEF",
    progressTimeMode: "remaining",
    anchoredPlayerSize: { width: 500.5, height: 300.4 },
    compactPlayerWidth: 321.6,
    trackHighlightColor: "cyan",
    unknownSetting: "ignored",
  };

  assert.deepEqual(plain(api.normalizeSettings(input)), {
    autoShowCompact: true,
    compactProgressColor: "custom",
    compactProgressCustomColor: "#a1b2c3",
    compactProgressStyle: "normal",
    floatingPlayerPosition: { left: 10, top: 21 },
    floatingPlayerSize: { width: 400, height: 241 },
    progressColor: "green",
    progressCustomColor: "#abcdef",
    progressTimeMode: "remaining",
    anchoredPlayerSize: { width: 501, height: 300 },
    compactPlayerWidth: 322,
    trackHighlightColor: "cyan",
  });
  assert.equal(input.compactProgressCustomColor, "#A1B2C3", "normalization should not mutate its input");
});

test("invalid values fall back atomically to defaults", async () => {
  const api = await loadSettings();
  const normalized = api.normalizeSettings({
    autoShowCompact: 1,
    compactProgressColor: "orange",
    compactProgressCustomColor: "red",
    compactProgressStyle: "large",
    floatingPlayerPosition: { left: -1, top: 20 },
    floatingPlayerSize: { width: 300, height: 0 },
    progressColor: null,
    progressCustomColor: "#12345g",
    progressTimeMode: "elapsed",
    anchoredPlayerSize: { width: Infinity, height: 200 },
    compactPlayerWidth: 0.9,
    trackHighlightColor: "ultraviolet",
  });

  assert.deepEqual(plain(normalized), plain(api.DEFAULT_SETTINGS));
  assert.deepEqual(plain(api.normalizeSettings({
    floatingPlayerPosition: { left: 0, top: 0 },
    floatingPlayerSize: { width: 1, height: 1 },
    compactPlayerWidth: 1,
  })), {
    ...plain(api.DEFAULT_SETTINGS),
    floatingPlayerPosition: { left: 0, top: 0 },
    floatingPlayerSize: { width: 1, height: 1 },
    compactPlayerWidth: 1,
  });
});

test("without an extension API loading returns defaults and saving reports failure", async () => {
  const api = await loadSettings();

  assert.deepEqual(plain(await loadStoredSettings(api)), plain(api.DEFAULT_SETTINGS));
  assert.equal(await saveStoredSettings(api, { autoShowCompact: true }), false);
  assert.doesNotThrow(() => api.addSettingsChangeListener(() => {})());
});

test("the promise-based browser adapter normalizes loads and filters saved keys", async () => {
  const calls = { get: [], set: [] };
  const browser = {
    storage: {
      local: {
        async get(defaults) {
          calls.get.push(defaults);
          return {
            autoShowCompact: true,
            progressColor: "purple",
            compactPlayerWidth: 300.7,
            trackHighlightColor: "not-valid",
          };
        },
        async set(payload) {
          calls.set.push(payload);
        },
      },
      onChanged: createChangeEvent(),
    },
  };
  const api = await loadSettings({ browser });

  const loaded = await loadStoredSettings(api);
  assert.equal(loaded.autoShowCompact, true);
  assert.equal(loaded.progressColor, "purple");
  assert.equal(loaded.compactPlayerWidth, 301);
  assert.equal(loaded.trackHighlightColor, api.DEFAULT_SETTINGS.trackHighlightColor);
  assert.deepEqual(Object.keys(calls.get[0]).sort(), Object.keys(api.DEFAULT_SETTINGS).sort());

  assert.equal(await saveStoredSettings(api, {
    autoShowCompact: true,
    compactPlayerWidth: 299.6,
    progressColor: "invalid",
    unknownSetting: "do not persist",
  }), true);
  assert.deepEqual(plain(calls.set[0]), {
    autoShowCompact: true,
    compactPlayerWidth: 300,
    progressColor: "red",
  });
});

test("promise adapter failures fall back on load and report failed saves", async () => {
  const browser = {
    storage: {
      local: {
        async get() {
          throw new Error("read failed");
        },
        async set() {
          throw new Error("write failed");
        },
      },
    },
  };
  const api = await loadSettings({ browser });

  assert.deepEqual(plain(await loadStoredSettings(api)), plain(api.DEFAULT_SETTINGS));
  assert.equal(await saveStoredSettings(api, { autoShowCompact: true }), false);
});

test("the callback-based chrome adapter handles success and runtime.lastError", async () => {
  const calls = { get: 0, set: [] };
  const chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(_defaults, callback) {
          calls.get += 1;
          callback({ progressTimeMode: "remaining", floatingPlayerPosition: { left: 4.6, top: 8.2 } });
        },
        set(payload, callback) {
          calls.set.push(payload);
          callback();
        },
      },
      onChanged: createChangeEvent(),
    },
  };
  const api = await loadSettings({ chrome });

  const loaded = await loadStoredSettings(api);
  assert.equal(calls.get, 1);
  assert.equal(loaded.progressTimeMode, "remaining");
  assert.deepEqual(plain(loaded.floatingPlayerPosition), { left: 5, top: 8 });
  assert.equal(await saveStoredSettings(api, { progressCustomColor: "#AABBCC" }), true);
  assert.deepEqual(plain(calls.set[0]), { progressCustomColor: "#aabbcc" });

  chrome.storage.local.get = (_defaults, callback) => {
    chrome.runtime.lastError = { message: "read failed" };
    callback({ autoShowCompact: true });
    chrome.runtime.lastError = null;
  };
  assert.deepEqual(plain(await loadStoredSettings(api)), plain(api.DEFAULT_SETTINGS));

  chrome.storage.local.set = (_payload, callback) => {
    chrome.runtime.lastError = { message: "write failed" };
    callback();
    chrome.runtime.lastError = null;
  };
  assert.equal(await saveStoredSettings(api, { autoShowCompact: true }), false);
});

test("storage change listeners forward only local changes and clean up", async () => {
  const onChanged = createChangeEvent();
  const browser = {
    storage: {
      local: {
        async get() {
          return {};
        },
        async set() {},
      },
      onChanged,
    },
  };
  const api = await loadSettings({ browser });
  const received = [];
  const cleanup = api.addSettingsChangeListener((changes) => received.push(changes));

  assert.equal(onChanged.listenerCount(), 1);
  onChanged.dispatch({ autoShowCompact: { newValue: true } }, "sync");
  onChanged.dispatch({ autoShowCompact: { newValue: true } }, "local");
  assert.equal(received.length, 1);

  cleanup();
  assert.equal(onChanged.listenerCount(), 0);
  onChanged.dispatch({ progressColor: { newValue: "green" } }, "local");
  assert.equal(received.length, 1);
});

test("browser storage is preferred when both extension APIs are present", async () => {
  const browser = {
    storage: {
      local: {
        async get() {
          return { progressColor: "green" };
        },
        async set() {},
      },
    },
  };
  const chrome = {
    storage: {
      local: {
        get(_defaults, callback) {
          callback({ progressColor: "white" });
        },
        set(_payload, callback) {
          callback();
        },
      },
    },
  };
  const api = await loadSettings({ browser, chrome });

  assert.equal((await loadStoredSettings(api)).progressColor, "green");
});
