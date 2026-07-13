import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const DEFAULT_SETTINGS = {
  autoShowCompact: false,
  avoidVideoTitleOverlap: true,
  compactProgressColor: "red",
  compactProgressCustomColor: "#ff0033",
  compactProgressStyle: "subtle",
  progressColor: "red",
  progressCustomColor: "#ff0033",
  progressTimeMode: "duration",
  trackHighlightColor: "purple",
};

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.attributes = new Map();
    this.checked = false;
    this.listeners = new Map();
    this.textContent = "";
    this.value = "";
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) {
      listener({ target: this, ...event });
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  listenerCount(type) {
    return (this.listeners.get(type) || []).length;
  }

  querySelector() {
    return null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

class FakeTimers {
  constructor() {
    this.now = 0;
    this.nextId = 1;
    this.pending = new Map();
  }

  clearTimeout(id) {
    this.pending.delete(id);
  }

  setTimeout(callback, delay) {
    const id = this.nextId;
    this.nextId += 1;
    this.pending.set(id, { callback, dueAt: this.now + delay });
    return id;
  }

  advanceBy(duration) {
    const target = this.now + duration;

    while (true) {
      const next = [...this.pending.entries()]
        .filter(([, timer]) => timer.dueAt <= target)
        .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
      if (!next) {
        break;
      }

      const [id, timer] = next;
      this.pending.delete(id);
      this.now = timer.dueAt;
      timer.callback();
    }

    this.now = target;
  }
}

async function createOptionsHarness() {
  const source = await readFile(new URL("../src/options.js", import.meta.url), "utf8");
  const form = new FakeElement("settings-form");
  const autoShowInput = new FakeElement("auto-show-compact");
  const avoidVideoTitleOverlapInput = new FakeElement("avoid-video-title-overlap");
  const compactCustomInput = new FakeElement("compact-progress-custom-color");
  const progressCustomInput = new FakeElement("progress-custom-color");
  const status = new FakeElement("save-status");
  const elements = new Map([
    [form.id, form],
    [autoShowInput.id, autoShowInput],
    [avoidVideoTitleOverlapInput.id, avoidVideoTitleOverlapInput],
    [compactCustomInput.id, compactCustomInput],
    [progressCustomInput.id, progressCustomInput],
    [status.id, status],
  ]);
  const loadCallbacks = [];
  const saveCalls = [];
  const timers = new FakeTimers();
  const document = {
    createElement() {
      return new FakeElement();
    },
    getElementById(id) {
      return elements.get(id) || null;
    },
    querySelector() {
      return null;
    },
  };

  form.formValues = {
    compactProgressColor: "red",
    compactProgressCustomColor: "#ff0033",
    compactProgressStyle: "subtle",
    progressColor: "red",
    progressCustomColor: "#ff0033",
    progressTimeMode: "duration",
    trackHighlightColor: "purple",
  };

  class FakeFormData {
    constructor(target) {
      this.values = target.formValues;
    }

    get(name) {
      return this.values[name] ?? null;
    }
  }

  const context = vm.createContext({
    document,
    FormData: FakeFormData,
    TimestampPlayerSettings: {
      COMPACT_PROGRESS_COLORS: {},
      COMPACT_PROGRESS_STYLES: {},
      PROGRESS_TIME_MODES: {},
      TRACK_HIGHLIGHT_COLORS: {},
      loadSettings(callback) {
        loadCallbacks.push(callback);
      },
      saveSettings(settings, callback) {
        saveCalls.push({ settings, callback });
      },
    },
    window: {
      clearTimeout: timers.clearTimeout.bind(timers),
      setTimeout: timers.setTimeout.bind(timers),
    },
  });
  vm.runInContext(source, context);

  return {
    autoShowInput,
    avoidVideoTitleOverlapInput,
    form,
    loadCallbacks,
    saveCalls,
    status,
    timers,
  };
}

test("the options form remains inert and busy until stored settings load", async () => {
  const html = await readFile(new URL("../options.html", import.meta.url), "utf8");
  const harness = await createOptionsHarness();

  assert.match(html, /<form id="settings-form" class="settings-form" aria-busy="true" inert>/);
  assert.equal(harness.form.getAttribute("aria-busy"), "true");
  assert.equal(harness.form.hasAttribute("inert"), true);
  assert.equal(harness.form.listenerCount("change"), 0);

  harness.loadCallbacks[0](DEFAULT_SETTINGS);

  assert.equal(harness.form.getAttribute("aria-busy"), "false");
  assert.equal(harness.form.hasAttribute("inert"), false);
  assert.equal(harness.form.listenerCount("change"), 1);
  assert.equal(harness.autoShowInput.checked, false);
  assert.equal(harness.avoidVideoTitleOverlapInput.checked, true);
});

test("options markup, styles, and scripts expose loading and feedback semantics", async () => {
  const [html, css, packageSource] = await Promise.all([
    readFile(new URL("../options.html", import.meta.url), "utf8"),
    readFile(new URL("../src/options.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);

  assert.match(html, /id="save-status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(html, /id="avoid-video-title-overlap"[^>]*name="avoidVideoTitleOverlap"/);
  assert.match(css, /\.settings-form\[inert\]/);
  assert.match(css, /\.save-status\[data-status="success"\]/);
  assert.match(css, /\.save-status\[data-status="error"\]/);
  assert.equal(packageJson.scripts["test:options"], "node --test tests/options.test.mjs");
});

test("initialization binds change handling only once even if loading calls back twice", async () => {
  const harness = await createOptionsHarness();

  harness.loadCallbacks[0](DEFAULT_SETTINGS);
  harness.loadCallbacks[0]({ ...DEFAULT_SETTINGS, autoShowCompact: true });
  harness.form.dispatch("change", { target: harness.autoShowInput });

  assert.equal(harness.form.listenerCount("change"), 1);
  assert.equal(harness.autoShowInput.checked, false, "a duplicate callback must not overwrite the initialized form");
  assert.equal(harness.saveCalls.length, 1, "one change should start only one save");
});

test("successful save feedback clears after the short confirmation timeout", async () => {
  const harness = await createOptionsHarness();
  harness.loadCallbacks[0](DEFAULT_SETTINGS);
  harness.form.dispatch("change", { target: harness.autoShowInput });

  harness.saveCalls[0].callback(true);
  assert.equal(harness.status.textContent, "Saved");
  assert.equal(harness.status.getAttribute("data-status"), "success");

  harness.timers.advanceBy(1599);
  assert.equal(harness.status.textContent, "Saved");
  harness.timers.advanceBy(1);
  assert.equal(harness.status.textContent, "");
  assert.equal(harness.status.hasAttribute("data-status"), false);
});

test("full-form saves serialize and coalesce so the latest snapshot persists last", async () => {
  const harness = await createOptionsHarness();
  harness.loadCallbacks[0](DEFAULT_SETTINGS);
  harness.form.dispatch("change", { target: harness.autoShowInput });
  harness.autoShowInput.checked = true;
  harness.form.dispatch("change", { target: harness.autoShowInput });
  harness.avoidVideoTitleOverlapInput.checked = false;
  harness.form.formValues.progressColor = "green";
  harness.form.dispatch("change", { target: harness.avoidVideoTitleOverlapInput });

  assert.equal(harness.saveCalls.length, 1, "a newer full-form write waits for the active write");
  const persistedSettings = {};
  Object.assign(persistedSettings, harness.saveCalls[0].settings);
  harness.saveCalls[0].callback(true);
  assert.equal(harness.saveCalls.length, 2, "the latest pending snapshot starts after completion");
  assert.equal(harness.saveCalls[1].settings.autoShowCompact, true);
  assert.equal(harness.saveCalls[1].settings.avoidVideoTitleOverlap, false);
  assert.equal(harness.saveCalls[1].settings.progressColor, "green");
  assert.equal(harness.status.textContent, "", "an obsolete completion must not report success");

  Object.assign(persistedSettings, harness.saveCalls[1].settings);
  harness.saveCalls[1].callback(true);
  assert.equal(persistedSettings.autoShowCompact, true);
  assert.equal(persistedSettings.avoidVideoTitleOverlap, false);
  assert.equal(persistedSettings.progressColor, "green");
  assert.equal(harness.saveCalls.length, 2, "the superseded middle snapshot is never written");
  assert.equal(harness.status.textContent, "Saved");
  assert.equal(harness.status.getAttribute("data-status"), "success");
  harness.timers.advanceBy(1600);
  assert.equal(harness.status.textContent, "");
});

test("failed save feedback remains visible materially longer than success feedback", async () => {
  const harness = await createOptionsHarness();
  harness.loadCallbacks[0](DEFAULT_SETTINGS);
  harness.form.dispatch("change", { target: harness.autoShowInput });

  harness.saveCalls[0].callback(false);
  assert.equal(harness.status.textContent, "Could not save settings");
  assert.equal(harness.status.getAttribute("data-status"), "error");

  harness.timers.advanceBy(5999);
  assert.equal(harness.status.textContent, "Could not save settings");
  harness.timers.advanceBy(1);
  assert.equal(harness.status.textContent, "");
  assert.equal(harness.status.hasAttribute("data-status"), false);
});

test("a newer edit immediately clears stale success and failure feedback", async () => {
  const harness = await createOptionsHarness();
  harness.loadCallbacks[0](DEFAULT_SETTINGS);

  harness.form.dispatch("change", { target: harness.autoShowInput });
  harness.saveCalls[0].callback(true);
  assert.equal(harness.status.textContent, "Saved");
  harness.form.dispatch("change", { target: harness.autoShowInput });
  assert.equal(harness.status.textContent, "");
  assert.equal(harness.status.hasAttribute("data-status"), false);

  harness.saveCalls[1].callback(false);
  assert.equal(harness.status.textContent, "Could not save settings");
  harness.form.dispatch("change", { target: harness.autoShowInput });
  assert.equal(harness.status.textContent, "");
  assert.equal(harness.status.hasAttribute("data-status"), false);
});

test("an older feedback timer cannot clear the latest save result", async () => {
  const harness = await createOptionsHarness();
  harness.loadCallbacks[0](DEFAULT_SETTINGS);
  harness.form.dispatch("change", { target: harness.autoShowInput });
  harness.saveCalls[0].callback(true);
  harness.timers.advanceBy(1000);

  harness.form.dispatch("change", { target: harness.autoShowInput });
  harness.saveCalls[1].callback(true);
  harness.timers.advanceBy(600);
  assert.equal(harness.status.textContent, "Saved", "the first save's former deadline is inert");

  harness.timers.advanceBy(999);
  assert.equal(harness.status.textContent, "Saved");
  harness.timers.advanceBy(1);
  assert.equal(harness.status.textContent, "");
});
