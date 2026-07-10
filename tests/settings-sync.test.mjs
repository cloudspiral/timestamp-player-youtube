import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const DEFAULT_SETTINGS = Object.freeze({
  autoShowCompact: false,
  progressColor: "red",
  progressTimeMode: "duration",
});

async function loadSettingsSync() {
  const source = await readFile(new URL("../src/settings-sync.js", import.meta.url), "utf8");
  const context = vm.createContext({
    TimestampPlayerSettings: { DEFAULT_SETTINGS },
  });
  vm.runInContext(source, context);
  return context.TimestampPlayerSettingsSync;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createHarness(api) {
  const events = [];
  const loadCallbacks = [];
  const listeners = [];
  const cleanups = [];
  let settings = { ...DEFAULT_SETTINGS };
  const controller = api.createSettingsSyncController({
    applySettings(nextSettings) {
      settings = { ...nextSettings };
      events.push(["apply", plain(settings)]);
    },
    getSettings: () => settings,
    load(callback) {
      events.push(["load"]);
      loadCallbacks.push(callback);
    },
    subscribe(listener) {
      events.push(["subscribe"]);
      const record = { active: true, listener };
      listeners.push(record);
      const cleanup = () => {
        if (record.active) {
          record.active = false;
          events.push(["cleanup"]);
        }
      };
      cleanups.push(cleanup);
      return cleanup;
    },
  });
  return {
    cleanups,
    controller,
    dispatch(changes, index = listeners.length - 1) {
      if (listeners[index]?.active) {
        listeners[index].listener(changes);
      }
    },
    events,
    getSettings: () => settings,
    listeners,
    loadCallbacks,
  };
}

test("subscribes before loading and lets changes during load win", async () => {
  const api = await loadSettingsSync();
  const harness = createHarness(api);

  harness.controller.start();
  assert.deepEqual(harness.events.slice(0, 2), [["subscribe"], ["load"]]);

  harness.dispatch({ progressColor: { newValue: "green" } });
  harness.loadCallbacks[0]({
    ...DEFAULT_SETTINGS,
    autoShowCompact: true,
    progressColor: "purple",
  });

  assert.deepEqual(plain(harness.getSettings()), {
    ...DEFAULT_SETTINGS,
    autoShowCompact: true,
    progressColor: "green",
  });
});

test("merges post-load changes against current settings and ignores unknown keys", async () => {
  const api = await loadSettingsSync();
  const harness = createHarness(api);
  harness.controller.start();
  harness.loadCallbacks[0]({ ...DEFAULT_SETTINGS, autoShowCompact: true });

  harness.dispatch({
    progressTimeMode: { newValue: "remaining" },
    privateSetting: { newValue: "ignored" },
  });

  assert.deepEqual(plain(harness.getSettings()), {
    ...DEFAULT_SETTINGS,
    autoShowCompact: true,
    progressTimeMode: "remaining",
  });
});

test("preserves deleted known keys so downstream normalization can restore defaults", async () => {
  const api = await loadSettingsSync();
  const harness = createHarness(api);
  harness.controller.start();

  harness.dispatch({ progressColor: { oldValue: "purple" } });
  harness.loadCallbacks[0]({ ...DEFAULT_SETTINGS, progressColor: "purple" });

  assert.equal(Object.hasOwn(harness.getSettings(), "progressColor"), true);
  assert.equal(harness.getSettings().progressColor, undefined);
});

test("new starts invalidate old loads and clean each listener exactly once", async () => {
  const api = await loadSettingsSync();
  const harness = createHarness(api);
  harness.controller.start();
  harness.controller.start();

  assert.equal(harness.listeners[0].active, false);
  assert.equal(harness.listeners[1].active, true);
  assert.equal(harness.events.filter(([event]) => event === "cleanup").length, 1);

  harness.loadCallbacks[0]({ ...DEFAULT_SETTINGS, progressColor: "purple" });
  assert.equal(harness.getSettings().progressColor, "red");
  harness.loadCallbacks[1]({ ...DEFAULT_SETTINGS, progressColor: "green" });
  assert.equal(harness.getSettings().progressColor, "green");

  harness.controller.stop();
  harness.controller.stop();
  assert.equal(harness.events.filter(([event]) => event === "cleanup").length, 2);
});

test("stop invalidates queued and duplicate load callbacks", async () => {
  const api = await loadSettingsSync();
  const harness = createHarness(api);
  harness.controller.start();
  const callback = harness.loadCallbacks[0];
  callback({ ...DEFAULT_SETTINGS, progressColor: "green" });
  callback({ ...DEFAULT_SETTINGS, progressColor: "purple" });
  assert.equal(harness.getSettings().progressColor, "green");

  harness.controller.start();
  const stoppedCallback = harness.loadCallbacks[1];
  harness.controller.stop();
  stoppedCallback({ ...DEFAULT_SETTINGS, progressColor: "purple" });
  assert.equal(harness.getSettings().progressColor, "green");
});

test("validates controller dependencies", async () => {
  const api = await loadSettingsSync();
  assert.throws(() => api.createSettingsSyncController(), /dependencies are required/);
});

test("extension wiring owns settings synchronization across Watch activation lifecycles", async () => {
  const [manifest, packageJson, contentSource] = await Promise.all([
    readFile(new URL("../manifest.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../src/content.js", import.meta.url), "utf8"),
  ]);
  const scripts = manifest.content_scripts[0].js;
  const settingsIndex = scripts.indexOf("src/settings.js");
  const syncIndex = scripts.indexOf("src/settings-sync.js");
  const contentIndex = scripts.indexOf("src/content.js");

  assert.ok(settingsIndex >= 0);
  assert.ok(syncIndex > settingsIndex);
  assert.ok(syncIndex < contentIndex);
  assert.match(contentSource, /const settingsSync = createSettingsSyncController\(\{/);
  assert.match(contentSource, /function activateWatchPage[\s\S]*settingsSync\.start\(\)/);
  assert.match(contentSource, /function deactivateWatchPage[\s\S]*settingsSync\.stop\(\)/);
  assert.doesNotMatch(contentSource, /settingsChangeCleanup|function loadStoredSettings\b/);
  assert.equal(
    packageJson.scripts["test:settings-sync"],
    "node --test tests/settings-sync.test.mjs"
  );
});
