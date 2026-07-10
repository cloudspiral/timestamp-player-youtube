import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const runtimePromise = readFile(
  new URL("../src/player-view.js", import.meta.url),
  "utf8"
).then((source) => {
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return context.TimestampPlayerPlayerView;
});
const contentSourcePromise = readFile(
  new URL("../src/content.js", import.meta.url),
  "utf8"
);
const manifestPromise = readFile(
  new URL("../manifest.json", import.meta.url),
  "utf8"
).then(JSON.parse);
const packagePromise = readFile(
  new URL("../package.json", import.meta.url),
  "utf8"
).then(JSON.parse);

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    if (!listeners.includes(listener)) {
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }
  }

  removeEventListener(type, listener) {
    const listeners = (this.listeners.get(type) || []).filter((item) => item !== listener);
    if (listeners.length) {
      this.listeners.set(type, listeners);
    } else {
      this.listeners.delete(type);
    }
  }

  dispatchEvent(event) {
    event.target ??= this;
    event.currentTarget = this;
    for (const listener of [...(this.listeners.get(event.type) || [])]) {
      listener.call(this, event);
    }
    return !event.defaultPrevented;
  }

  listenerCount(type) {
    return this.listeners.get(type)?.length || 0;
  }
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  contains(name) {
    return this.values.has(name);
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) {
      this.values.add(name);
    } else {
      this.values.delete(name);
    }
    return enabled;
  }
}

class FakeStyle {
  constructor() {
    this.properties = new Map();
  }

  getPropertyValue(name) {
    return this.properties.get(name) || "";
  }

  setProperty(name, value) {
    this.properties.set(name, String(value));
  }
}

class FakeElement extends FakeEventTarget {
  constructor(documentObject, tagName = "div") {
    super();
    this.documentObject = documentObject;
    this.tagName = tagName.toUpperCase();
    this.parentElement = null;
    this.children = [];
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.style = new FakeStyle();
    this.disabled = false;
    this.id = "";
    this.textContent = "";
    this.title = "";
    this.type = "";
    this._innerHTML = "";
  }

  get isConnected() {
    if (this === this.documentObject.documentElement) {
      return true;
    }
    return Boolean(this.parentElement?.isConnected);
  }

  get className() {
    return [...this.classList.values].join(" ");
  }

  set className(value) {
    this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
    const tagPattern = /<(div|button|span|svg|text)\b([^>]*)>/gi;
    for (const match of this._innerHTML.matchAll(tagPattern)) {
      const child = new FakeElement(this.documentObject, match[1]);
      const attributePattern = /([a-zA-Z][\w:-]*)="([^"]*)"/g;
      for (const attribute of match[2].matchAll(attributePattern)) {
        child.setAttribute(attribute[1], attribute[2]);
      }
      this.append(child);
    }
  }

  append(...children) {
    for (const child of children) {
      child.remove();
      child.parentElement = this;
      this.children.push(child);
    }
  }

  contains(node) {
    return node === this || this.children.some((child) => child.contains(node));
  }

  closest(selector) {
    for (let element = this; element; element = element.parentElement) {
      if (element.matches(selector)) {
        return element;
      }
    }
    return null;
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  matches(selector) {
    if (selector.startsWith(".")) {
      return this.classList.contains(selector.slice(1));
    }
    if (selector.startsWith("#")) {
      return this.id === selector.slice(1);
    }
    return this.tagName === selector.toUpperCase();
  }

  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches(selector)) {
        return child;
      }
      const nested = child.querySelector(selector);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  remove() {
    if (!this.parentElement) {
      return;
    }
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) {
      this.parentElement.children.splice(index, 1);
    }
    this.parentElement = null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "title") {
      this.title = "";
    }
  }

  setAttribute(name, value) {
    const stringValue = String(value);
    this.attributes.set(name, stringValue);
    if (name === "class") {
      this.className = stringValue;
    } else if (name === "id") {
      this.id = stringValue;
    } else if (name === "title") {
      this.title = stringValue;
    } else if (name === "type") {
      this.type = stringValue;
    }
  }
}

class FakeDocument {
  constructor() {
    this.createdElements = [];
    this.documentElement = new FakeElement(this, "html");
  }

  createElement(tagName) {
    const element = new FakeElement(this, tagName);
    this.createdElements.push(element);
    return element;
  }

  getElementById(id) {
    if (this.documentElement.id === id) {
      return this.documentElement;
    }
    return findElement(this.documentElement, (element) => element.id === id);
  }
}

function findElement(root, predicate) {
  for (const child of root.children) {
    if (predicate(child)) {
      return child;
    }
    const nested = findElement(child, predicate);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function event(type, overrides = {}) {
  return {
    button: 0,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    type,
    ...overrides,
  };
}

function formatTimestamp(seconds) {
  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  return `${minutes}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

async function createHarness({ handlers = {} } = {}) {
  const runtime = await runtimePromise;
  const documentObject = new FakeDocument();
  const rendererRecords = [];
  const createTrackListRenderer = (dependencies) => {
    const record = {
      activeCalls: [],
      clearCalls: 0,
      collectionCalls: [],
      dependencies,
      row: { kind: "track-row" },
    };
    rendererRecords.push(record);
    return {
      clear() {
        record.clearCalls += 1;
      },
      getRowForIndex(index) {
        record.requestedIndex = index;
        return record.row;
      },
      renderActive(index) {
        record.activeCalls.push(index);
        return true;
      },
      renderCollection(tracks) {
        record.collectionCalls.push(tracks);
        return true;
      },
    };
  };
  const compactProgressColors = {
    custom: { color: null },
    green: { color: "#00aa66" },
    red: { color: "#ff0033" },
  };
  const compactProgressStyles = {
    normal: { height: "2px", opacity: "1" },
    subtle: { height: "1px", opacity: "0.75" },
  };
  const trackHighlightColors = {
    cyan: { bg: "cyan-bg", hoverBg: "cyan-hover", text: "cyan-text" },
    purple: { bg: "purple-bg", hoverBg: "purple-hover", text: "purple-text" },
  };
  const controller = runtime.createPlayerViewController({
    compactProgressColors,
    compactProgressStyles,
    createTrackListRenderer,
    document: documentObject,
    formatTimestamp,
    formatTrackLabel: (track) => `Track: ${track.title}`,
    handlers,
    trackHighlightColors,
  });
  return { controller, documentObject, rendererRecords, runtime };
}

test("ensure constructs and binds one stable player shell", async () => {
  const harness = await createHarness();
  assert.equal(harness.controller.getElements(), null);

  const first = harness.controller.ensure();
  const second = harness.controller.ensure();

  assert.equal(first, second);
  assert.equal(first.root.id, harness.runtime.ROOT_ID);
  assert.equal(harness.documentObject.documentElement.children.length, 1);
  assert.equal(harness.documentObject.createdElements.length, 1);
  assert.equal(harness.rendererRecords.length, 1);
  assert.equal(harness.rendererRecords[0].dependencies.listElement, first.listEl);
  assert.match(first.root.innerHTML, /class="ts-progress-remaining" role="button" aria-pressed="false"/);
  assert.match(first.root.innerHTML, /class="ts-progress-slider" aria-label="Seek within current track" aria-disabled="false"/);
  assert.equal(first.dragHandle.listenerCount("pointerdown"), 0);
  assert.equal(first.resizeHandle.listenerCount("pointerdown"), 0);
});

test("stable controls delegate callbacks while preserving mouse-focus behavior", async () => {
  const called = [];
  const handlerNames = [
    "onCompactToggle",
    "onPanelModeToggle",
    "onClose",
    "onCurrentTrackClick",
    "onPreviousTrack",
    "onPlayPause",
    "onShuffleToggle",
    "onRepeatToggle",
    "onNextTrack",
    "onProgressPointerDown",
    "onProgressTimeModeToggle",
    "onTrackListClick",
  ];
  const handlers = Object.fromEntries(
    handlerNames.map((name) => [name, () => called.push(name)])
  );
  const harness = await createHarness({ handlers });
  const elements = harness.controller.ensure();
  const bindings = [
    [elements.compactButton, "click", "onCompactToggle"],
    [elements.popoutButton, "click", "onPanelModeToggle"],
    [elements.closeButton, "click", "onClose"],
    [elements.trackEl, "click", "onCurrentTrackClick"],
    [elements.previousButton, "click", "onPreviousTrack"],
    [elements.playPauseButton, "click", "onPlayPause"],
    [elements.toggleButton, "click", "onShuffleToggle"],
    [elements.repeatButton, "click", "onRepeatToggle"],
    [elements.nextButton, "click", "onNextTrack"],
    [elements.progressSlider, "pointerdown", "onProgressPointerDown"],
    [elements.progressRemainingEl, "click", "onProgressTimeModeToggle"],
    [elements.listEl, "click", "onTrackListClick"],
  ];
  for (const [target, type, expected] of bindings) {
    target.dispatchEvent(event(type));
    assert.equal(called.at(-1), expected);
  }
  assert.deepEqual(called, handlerNames);

  const rightTimeDown = event("pointerdown");
  elements.progressRemainingEl.dispatchEvent(rightTimeDown);
  assert.equal(rightTimeDown.defaultPrevented, true);

  const primaryMouseDown = event("mousedown", { target: elements.playPauseButton });
  elements.root.dispatchEvent(primaryMouseDown);
  assert.equal(primaryMouseDown.defaultPrevented, true);
  const secondaryMouseDown = event("mousedown", {
    button: 2,
    target: elements.playPauseButton,
  });
  elements.root.dispatchEvent(secondaryMouseDown);
  assert.equal(secondaryMouseDown.defaultPrevented, false);
});

test("render reflects classes, controls, current-track text, and keyed-list state", async () => {
  const harness = await createHarness();
  const tracks = [
    { index: 0, start: 0, title: "Opening" },
    { index: 1, start: 60, title: "Finale" },
  ];
  const elements = harness.controller.render({
    anchored: true,
    anchoredCompact: true,
    currentTrackIndex: 0,
    floating: false,
    inlineCompact: true,
    playing: true,
    repeatEnabled: true,
    shuffleEnabled: true,
    tracks,
    tracksAvailable: true,
    visible: true,
  });

  for (const className of [
    "is-shuffle-enabled",
    "is-repeat-enabled",
    "is-playing",
    "has-tracks",
    "is-visible",
    "is-anchored",
    "is-anchored-compact",
    "is-inline-compact",
  ]) {
    assert.equal(elements.root.classList.contains(className), true, className);
  }
  assert.equal(elements.root.classList.contains("is-floating"), false);
  assert.equal(elements.playPauseButton.disabled, false);
  assert.equal(elements.playPauseButton.getAttribute("aria-label"), "Pause");
  assert.equal(elements.toggleButton.getAttribute("aria-label"), "Turn shuffle off");
  assert.equal(elements.toggleButton.title, "Shuffle on");
  assert.equal(elements.repeatButton.getAttribute("aria-label"), "Turn repeat off");
  assert.equal(elements.repeatButton.title, "Repeat on");
  assert.equal(elements.compactButton.getAttribute("aria-label"), "Expand player");
  assert.equal(elements.compactButton.getAttribute("aria-pressed"), "true");
  assert.equal(elements.popoutButton.getAttribute("aria-label"), "Pop out player");
  assert.equal(elements.trackEl.textContent, "Track: Opening");
  assert.equal(elements.trackEl.title, "Track: Opening");
  assert.equal(elements.countEl.textContent, "1 / 2");

  const renderer = harness.rendererRecords[0];
  assert.equal(renderer.collectionCalls[0], tracks);
  assert.deepEqual(renderer.activeCalls, [0]);

  harness.controller.render({ floating: true });
  assert.equal(elements.root.classList.contains("is-visible"), false);
  assert.equal(elements.root.classList.contains("is-floating"), true);
  assert.equal(elements.playPauseButton.disabled, true);
  assert.equal(elements.playPauseButton.getAttribute("aria-label"), "Play");
  assert.equal(elements.compactButton.disabled, true);
  assert.equal(elements.popoutButton.getAttribute("aria-label"), "Dock player");
  assert.equal(elements.trackEl.textContent, "No track selected");
  assert.equal(elements.trackEl.title, "");
  assert.equal(elements.countEl.textContent, "");
});

test("progress rendering preserves remaining, duration, and reset presentations", async () => {
  const harness = await createHarness();
  harness.controller.renderProgress({
    active: true,
    duration: 100,
    elapsed: 25,
    timeMode: harness.runtime.PROGRESS_TIME_MODES.REMAINING,
  });
  const elements = harness.controller.getElements();
  assert.equal(elements.progressElapsedEl.textContent, "0:25");
  assert.equal(elements.progressRemainingEl.textContent, "-1:15");
  assert.equal(elements.progressRemainingEl.title, "Show track duration");
  assert.equal(elements.progressRemainingEl.getAttribute("aria-pressed"), "false");
  assert.equal(elements.progressSlider.style.getPropertyValue("--ts-progress"), "25%");
  assert.equal(elements.progressSlider.title, "0:25 elapsed, 1:15 remaining");

  harness.controller.renderProgress({
    active: true,
    duration: 100,
    elapsed: 150,
    timeMode: harness.runtime.PROGRESS_TIME_MODES.DURATION,
  });
  assert.equal(elements.progressElapsedEl.textContent, "1:40");
  assert.equal(elements.progressRemainingEl.textContent, "1:40");
  assert.equal(elements.progressRemainingEl.title, "Show remaining time");
  assert.equal(elements.progressRemainingEl.getAttribute("aria-pressed"), "true");
  assert.equal(elements.progressSlider.style.getPropertyValue("--ts-progress"), "100%");

  harness.controller.renderProgress({
    active: false,
    timeMode: harness.runtime.PROGRESS_TIME_MODES.DURATION,
  });
  assert.equal(elements.progressElapsedEl.textContent, "0:00");
  assert.equal(elements.progressRemainingEl.textContent, "0:00");
  assert.equal(elements.progressSlider.style.getPropertyValue("--ts-progress"), "0%");
  assert.equal(elements.progressSlider.title, "");
});

test("settings map to the existing player CSS variables with current fallbacks", async () => {
  const harness = await createHarness();
  assert.equal(harness.controller.applySettings({}), false);
  const elements = harness.controller.ensure();

  assert.equal(harness.controller.applySettings({
    compactProgressColor: "custom",
    compactProgressCustomColor: "#123456",
    compactProgressStyle: "normal",
    progressColor: "green",
    progressCustomColor: "#abcdef",
    trackHighlightColor: "cyan",
  }), true);
  assert.equal(elements.root.style.getPropertyValue("--ts-compact-progress-height"), "2px");
  assert.equal(elements.root.style.getPropertyValue("--ts-compact-progress-opacity"), "1");
  assert.equal(elements.root.style.getPropertyValue("--ts-compact-progress-color"), "#123456");
  assert.equal(elements.root.style.getPropertyValue("--ts-progress-color"), "#00aa66");
  assert.equal(elements.root.style.getPropertyValue("--ts-active-track-bg"), "cyan-bg");
  assert.equal(elements.root.style.getPropertyValue("--ts-active-track-hover-bg"), "cyan-hover");
  assert.equal(elements.root.style.getPropertyValue("--ts-active-track-text"), "cyan-text");

  harness.controller.applySettings({
    compactProgressColor: "unknown",
    compactProgressStyle: "unknown",
    progressColor: "unknown",
    trackHighlightColor: "unknown",
  });
  assert.equal(elements.root.style.getPropertyValue("--ts-compact-progress-height"), "1px");
  assert.equal(elements.root.style.getPropertyValue("--ts-compact-progress-color"), "#ff0033");
  assert.equal(elements.root.style.getPropertyValue("--ts-progress-color"), "#ff0033");
  assert.equal(elements.root.style.getPropertyValue("--ts-active-track-bg"), "purple-bg");
});

test("keyed-list delegation and teardown keep renderer and listeners owned", async () => {
  let closes = 0;
  const harness = await createHarness({
    handlers: {
      onClose: () => {
        closes += 1;
      },
    },
  });
  const elements = harness.controller.ensure();
  const tracks = [{ index: 4, start: 20, title: "Track" }];
  const changes = harness.controller.renderTrackList(tracks, 4);
  assert.equal(changes.collectionChanged, true);
  assert.equal(changes.activeChanged, true);
  assert.equal(harness.controller.getTrackRowForIndex(4), harness.rendererRecords[0].row);
  assert.equal(harness.rendererRecords[0].requestedIndex, 4);

  elements.closeButton.dispatchEvent(event("click"));
  assert.equal(closes, 1);
  harness.controller.teardown();
  assert.equal(harness.rendererRecords[0].clearCalls, 1);
  assert.equal(elements.root.isConnected, false);
  assert.equal(harness.controller.getElements(), null);
  elements.closeButton.dispatchEvent(event("click"));
  assert.equal(closes, 1, "detached controls must not retain controller callbacks");

  const nextElements = harness.controller.ensure();
  assert.notEqual(nextElements.root, elements.root);
  assert.equal(harness.rendererRecords.length, 2);
});

test("ensure releases a detached shell before rebuilding its renderer and listeners", async () => {
  let closes = 0;
  const harness = await createHarness({
    handlers: {
      onClose: () => {
        closes += 1;
      },
    },
  });
  const firstElements = harness.controller.ensure();
  const firstRenderer = harness.rendererRecords[0];

  firstElements.closeButton.dispatchEvent(event("click"));
  assert.equal(closes, 1);
  firstElements.root.remove();
  assert.equal(firstElements.root.isConnected, false);

  const secondElements = harness.controller.ensure();
  assert.notEqual(secondElements.root, firstElements.root);
  assert.equal(firstRenderer.clearCalls, 1);
  assert.equal(harness.rendererRecords.length, 2);
  assert.equal(harness.documentObject.documentElement.children.length, 1);

  firstElements.closeButton.dispatchEvent(event("click"));
  assert.equal(closes, 1, "detached controls must release their old callbacks during rebuild");
  secondElements.closeButton.dispatchEvent(event("click"));
  assert.equal(closes, 2);
});

test("content delegates stable shell, settings, rendering, and list ownership to the view", async () => {
  const source = await contentSourcePromise;

  assert.match(source, /createPlayerViewController\(\{/);
  assert.match(source, /playerView\.ensure\(\)/);
  assert.match(
    source,
    /if \(elements\.root !== playerShellRoot\) \{[\s\S]*?playerLayout\.connect\(\{/
  );
  assert.equal(source.match(/playerLayout\.connect\(/g)?.length, 1);
  assert.match(source, /playerView\.applySettings\(state\.settings\)/);
  assert.match(source, /playerView\.render\(\{/);
  assert.match(source, /playerView\.renderProgress\(\{/);
  assert.match(
    source,
    /function updateProgress[\s\S]*?ensurePlayerUi\(\);[\s\S]*?playerView\.renderProgress\(\{/
  );
  assert.match(source, /playerView\.getTrackRowForIndex\(currentIndex\)/);
  assert.doesNotMatch(source, /function ensureUi\b/);
  assert.doesNotMatch(source, /function applySettingsToUi\b/);
  assert.doesNotMatch(source, /function renderTrackList\b/);
  assert.doesNotMatch(source, /function updateProgressRightTime\b/);
  assert.doesNotMatch(source, /trackListRenderer\s*=/);
  assert.doesNotMatch(source, /root\.classList\.toggle\("is-(?:visible|playing|floating)/);
  assert.doesNotMatch(source, /style\.setProperty\("--ts-(?:progress|active-track|compact-progress)/);

  const detachedCheck = source.indexOf("if (currentElements && !currentElements.root.isConnected)");
  const detachedScrubCleanup = source.indexOf(
    "cancelProgressPointerInteraction(currentElements.progressSlider);",
    detachedCheck
  );
  const detachedLayoutCleanup = source.indexOf("playerLayout.disconnect();", detachedCheck);
  const viewEnsure = source.indexOf("const elements = playerView.ensure();", detachedCheck);
  assert.ok(detachedCheck >= 0);
  assert.ok(detachedScrubCleanup > detachedCheck);
  assert.ok(detachedLayoutCleanup > detachedScrubCleanup);
  assert.ok(viewEnsure > detachedLayoutCleanup);

  const removeUiStart = source.indexOf("function removeWatchPageUi()");
  const progressCleanup = source.indexOf("cancelProgressPointerInteraction();", removeUiStart);
  const layoutDisconnect = source.indexOf("playerLayout.disconnect();", removeUiStart);
  const viewTeardown = source.indexOf("playerView.teardown();", removeUiStart);
  assert.ok(removeUiStart >= 0);
  assert.ok(progressCleanup > removeUiStart);
  assert.ok(layoutDisconnect > progressCleanup);
  assert.ok(viewTeardown > layoutDisconnect);
});

test("extension and package wiring load and verify the player view before content", async () => {
  const [manifest, packageJson] = await Promise.all([manifestPromise, packagePromise]);
  const scripts = manifest.content_scripts[0].js;
  const viewIndex = scripts.indexOf("src/player-view.js");
  const contentIndex = scripts.indexOf("src/content.js");

  assert.ok(viewIndex >= 0);
  assert.ok(contentIndex > viewIndex);
  assert.match(packageJson.scripts["check:js"], /node --check src\/player-view\.js/);
  assert.match(packageJson.scripts["check:js"], /node --check tests\/player-view\.test\.mjs/);
  assert.equal(
    packageJson.scripts["test:player-view"],
    "node --test tests/player-view.test.mjs"
  );
});
