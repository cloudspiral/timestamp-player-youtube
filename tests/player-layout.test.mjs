import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const runtimePromise = readFile(
  new URL("../src/player-layout.js", import.meta.url),
  "utf8"
).then((source) => {
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return context.TimestampPlayerPlayerLayout;
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

  addEventListener(type, listener, options = {}) {
    const records = this.listeners.get(type) || [];
    if (!records.some((record) => record.listener === listener)) {
      records.push({ listener, once: Boolean(options?.once) });
      this.listeners.set(type, records);
    }
  }

  removeEventListener(type, listener) {
    const records = this.listeners.get(type) || [];
    const remaining = records.filter((record) => record.listener !== listener);
    if (remaining.length) {
      this.listeners.set(type, remaining);
    } else {
      this.listeners.delete(type);
    }
  }

  dispatchEvent(event) {
    event.target ??= this;
    event.currentTarget = this;
    const records = [...(this.listeners.get(event.type) || [])];
    for (const record of records) {
      if (record.once) {
        this.removeEventListener(event.type, record.listener);
      }
      record.listener.call(this, event);
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

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement extends FakeEventTarget {
  constructor(documentObject, rect = {}) {
    super();
    this.documentObject = documentObject;
    this.parentElement = null;
    this.children = [];
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.style = {};
    this.id = "";
    this.pointerCaptures = new Set();
    this.releasedPointerIds = [];
    this.setRect(rect);
  }

  setRect(rect = {}) {
    const left = rect.left ?? 0;
    const top = rect.top ?? 0;
    const width = rect.width ?? Math.max(0, (rect.right ?? left) - left);
    const height = rect.height ?? Math.max(0, (rect.bottom ?? top) - top);
    this.rect = { left, top, width, height };
  }

  get isConnected() {
    if (this === this.documentObject.documentElement) {
      return true;
    }
    return Boolean(this.parentElement?.isConnected);
  }

  get nextSibling() {
    if (!this.parentElement) {
      return null;
    }
    const index = this.parentElement.children.indexOf(this);
    return this.parentElement.children[index + 1] || null;
  }

  append(...nodes) {
    for (const node of nodes) {
      node.remove();
      node.parentElement = this;
      this.children.push(node);
    }
  }

  insertBefore(node, referenceNode) {
    if (!referenceNode) {
      this.append(node);
      return;
    }
    const referenceIndex = this.children.indexOf(referenceNode);
    if (referenceIndex < 0) {
      throw new Error("Reference node is not a child");
    }
    node.remove();
    node.parentElement = this;
    this.children.splice(referenceIndex, 0, node);
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

  contains(node) {
    return node === this || this.children.some((child) => child.contains(node));
  }

  getBoundingClientRect() {
    const width = pixelValue(this.style.width) ?? this.rect.width;
    const height = pixelValue(this.style.height) ?? this.rect.height;
    let left = this.rect.left;
    let top = this.rect.top;
    const styledLeft = pixelValue(this.style.left);
    const styledTop = pixelValue(this.style.top);
    if (styledLeft !== null && this.style.position === "fixed") {
      left = styledLeft;
    } else if (styledLeft !== null && this.style.position === "absolute") {
      left = styledLeft - this.documentObject.windowObject.scrollX;
    }
    if (styledTop !== null && this.style.position === "fixed") {
      top = styledTop;
    } else if (styledTop !== null && this.style.position === "absolute") {
      top = styledTop - this.documentObject.windowObject.scrollY;
    }
    return {
      bottom: top + height,
      height,
      left,
      right: left + width,
      top,
      width,
      x: left,
      y: top,
    };
  }

  focus() {
    this.documentObject.activeElement = this;
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  setPointerCapture(pointerId) {
    this.pointerCaptures.add(pointerId);
  }

  releasePointerCapture(pointerId) {
    this.pointerCaptures.delete(pointerId);
    this.releasedPointerIds.push(pointerId);
  }

  hasPointerCapture(pointerId) {
    return this.pointerCaptures.has(pointerId);
  }
}

class FakeDocument {
  constructor(windowObject) {
    this.windowObject = windowObject;
    this.activeElement = null;
    this.documentElement = new FakeElement(this);
  }

  createElement() {
    return new FakeElement(this);
  }
}

class FakeWindow extends FakeEventTarget {
  constructor({ innerHeight, innerWidth, viewportHeight, viewportWidth }) {
    super();
    this.innerHeight = innerHeight;
    this.innerWidth = innerWidth;
    this.scrollX = 0;
    this.scrollY = 0;
    this.pageXOffset = 0;
    this.pageYOffset = 0;
    this.visualViewport = new FakeEventTarget();
    this.visualViewport.height = viewportHeight;
    this.visualViewport.width = viewportWidth;
  }
}

class FakeAnimationFrames {
  constructor() {
    this.nextId = 1;
    this.pending = new Map();
    this.cancelled = [];
  }

  request = (callback) => {
    const id = this.nextId;
    this.nextId += 1;
    this.pending.set(id, callback);
    return id;
  };

  cancel = (id) => {
    this.pending.delete(id);
    this.cancelled.push(id);
  };

  flush() {
    const frames = [...this.pending.entries()];
    this.pending.clear();
    frames.forEach(([, callback]) => callback(0));
  }
}

function pixelValue(value) {
  if (typeof value !== "string" || !value.endsWith("px")) {
    return null;
  }
  return Number(value.slice(0, -2));
}

function pointerEvent(type, overrides = {}) {
  return {
    button: 0,
    clientX: 0,
    clientY: 0,
    defaultPrevented: false,
    pointerId: 1,
    preventDefault() {
      this.defaultPrevented = true;
    },
    type,
    ...overrides,
  };
}

function keyEvent(key, overrides = {}) {
  return {
    defaultPrevented: false,
    key,
    propagationStopped: false,
    repeat: false,
    shiftKey: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    },
    type: "keydown",
    ...overrides,
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

async function createHarness({
  innerHeight = 900,
  innerWidth = 1400,
  rootRect = { height: 225, left: 100, top: 100, width: 400 },
  viewportHeight = 700,
  viewportWidth = 1000,
} = {}) {
  const runtime = await runtimePromise;
  const windowObject = new FakeWindow({
    innerHeight,
    innerWidth,
    viewportHeight,
    viewportWidth,
  });
  const documentObject = new FakeDocument(windowObject);
  const root = new FakeElement(documentObject, rootRect);
  const dragHandle = new FakeElement(documentObject);
  const resizeHandle = new FakeElement(documentObject);
  root.append(dragHandle, resizeHandle);
  documentObject.documentElement.append(root);

  const refs = {
    actionAnchor: null,
    actionRow: null,
    launcher: null,
  };
  const frames = new FakeAnimationFrames();
  const saves = [];
  const controller = runtime.createPlayerLayoutController({
    cancelFrame: frames.cancel,
    document: documentObject,
    findActionRow: () => refs.actionRow,
    findCompactActionAnchor: () => refs.actionAnchor,
    getLauncherElement: () => refs.launcher,
    requestFrame: frames.request,
    saveSettings: (settings) => saves.push(plain(settings)),
    window: windowObject,
  });
  controller.connect({ dragHandle, resizeHandle, root });

  return {
    controller,
    documentObject,
    dragHandle,
    element: (rect) => new FakeElement(documentObject, rect),
    frames,
    refs,
    resizeHandle,
    root,
    runtime,
    saves,
    windowObject,
  };
}

test("floating layout restores and clamps saved geometry against visualViewport", async () => {
  const harness = await createHarness();
  harness.controller.hydrate({
    floatingPlayerPosition: { left: 900, top: -40 },
    floatingPlayerSize: { height: 800, width: 1200 },
  });

  assert.equal(harness.controller.layoutNow({
    panelMode: harness.runtime.PANEL_MODES.FLOATING,
    visible: true,
  }), true);

  assert.equal(harness.root.style.position, "fixed");
  assert.equal(harness.root.style.width, "984px");
  assert.equal(harness.root.style.height, "684px");
  assert.equal(harness.root.style.left, "8px");
  assert.equal(harness.root.style.top, "8px");
  assert.equal(harness.root.classList.contains("has-custom-size"), true);
  const snapshot = harness.controller.getSnapshot();
  assert.deepEqual(plain(snapshot.playerSize), { height: 684, width: 984 });
  assert.deepEqual(plain(snapshot.playerPosition), { left: 8, top: 8 });
});

test("anchored layout uses page coordinates and its fixed fallback", async () => {
  const harness = await createHarness({
    rootRect: { height: 200, left: 0, top: 0, width: 360 },
    viewportHeight: 800,
    viewportWidth: 1200,
  });
  harness.windowObject.scrollX = 35;
  harness.windowObject.scrollY = 120;
  harness.refs.launcher = harness.element({ height: 40, left: 900, top: 500, width: 100 });
  harness.refs.actionAnchor = harness.element({ height: 50, left: 700, top: 490, width: 350 });
  harness.documentObject.documentElement.append(harness.refs.launcher, harness.refs.actionAnchor);

  harness.controller.layoutNow({
    anchoredCompact: false,
    inlineCompact: false,
    panelMode: harness.runtime.PANEL_MODES.ANCHORED,
    visible: true,
  });

  assert.equal(harness.root.style.position, "absolute");
  assert.equal(harness.root.style.left, "725px");
  assert.equal(harness.root.style.top, "412px");

  harness.refs.launcher.setRect({ height: 0, left: 900, top: 500, width: 0 });
  harness.controller.layoutNow();
  assert.equal(harness.root.style.position, "fixed");
  assert.equal(harness.root.style.left, "822px");
  assert.equal(harness.root.style.top, "512px");
});

test("compact layout aligns to the action anchor and mounts a host fallback", async () => {
  const harness = await createHarness({
    rootRect: { height: 200, left: 0, top: 0, width: 360 },
    viewportHeight: 700,
    viewportWidth: 900,
  });
  harness.windowObject.scrollX = 25;
  harness.windowObject.scrollY = 100;
  harness.refs.actionAnchor = harness.element({ height: 50, left: 600, top: 400, width: 250 });
  harness.documentObject.documentElement.append(harness.refs.actionAnchor);
  harness.controller.hydrate({ compactPlayerWidth: 900 });

  harness.controller.layoutNow({
    anchoredCompact: true,
    inlineCompact: true,
    panelMode: harness.runtime.PANEL_MODES.ANCHORED,
    visible: true,
  });

  assert.equal(harness.root.style.position, "absolute");
  assert.equal(harness.root.style.width, "842px");
  assert.equal(harness.root.style.height, "");
  assert.equal(harness.root.style.left, "33px");
  assert.equal(harness.root.style.top, "294px");
  assert.equal(harness.controller.getSnapshot().compactWidth, 900, "render clamps must not rewrite saved width");

  harness.refs.actionAnchor = null;
  harness.refs.actionRow = harness.element({ height: 50, left: 0, top: 400, width: 900 });
  harness.refs.launcher = harness.element({ height: 40, left: 500, top: 400, width: 100 });
  const trailingButton = harness.element({ height: 40, left: 610, top: 400, width: 100 });
  harness.documentObject.documentElement.append(harness.refs.actionRow);
  harness.refs.actionRow.append(harness.refs.launcher, trailingButton);
  harness.controller.layoutNow();

  const host = harness.controller.getSnapshot().compactHost;
  assert.equal(host.id, "timestamp-player-compact-host");
  assert.equal(host.parentElement, harness.refs.actionRow);
  assert.equal(harness.refs.launcher.nextSibling, host);
  assert.equal(harness.root.parentElement, host);
  assert.equal(harness.root.style.position, "");
  assert.equal(harness.root.style.left, "");

  assert.equal(harness.controller.prepareMount({ inlineCompact: true }), true);
  assert.equal(harness.root.parentElement, harness.documentObject.documentElement);
  assert.equal(host.isConnected, false);
  assert.equal(harness.root.style.width, "");
});

test("connecting identical elements is idempotent and preserves an active compact mount", async () => {
  const harness = await createHarness();
  harness.refs.actionRow = harness.element({ height: 50, left: 0, top: 400, width: 900 });
  harness.refs.launcher = harness.element({ height: 40, left: 500, top: 400, width: 100 });
  harness.documentObject.documentElement.append(harness.refs.actionRow);
  harness.refs.actionRow.append(harness.refs.launcher);
  harness.controller.layoutNow({
    anchoredCompact: true,
    inlineCompact: true,
    panelMode: harness.runtime.PANEL_MODES.ANCHORED,
    visible: true,
  });
  const host = harness.controller.getSnapshot().compactHost;

  const returned = harness.controller.connect({
    dragHandle: harness.dragHandle,
    resizeHandle: harness.resizeHandle,
    root: harness.root,
  });

  assert.equal(returned, harness.controller);
  assert.equal(host.isConnected, true);
  assert.equal(harness.root.parentElement, host);
  assert.equal(harness.dragHandle.listenerCount("pointerdown"), 1);
  assert.equal(harness.dragHandle.listenerCount("keydown"), 1);
  assert.equal(harness.dragHandle.listenerCount("blur"), 1);
  assert.equal(harness.resizeHandle.listenerCount("pointerdown"), 1);
  assert.equal(harness.resizeHandle.listenerCount("keydown"), 1);
  assert.equal(harness.resizeHandle.listenerCount("blur"), 1);
  assert.equal(harness.windowObject.listenerCount("resize"), 1);
  assert.equal(harness.windowObject.visualViewport.listenerCount("resize"), 1);
});

test("ownership covers the player and compact host without claiming neighboring actions", async () => {
  const harness = await createHarness();
  const unrelated = harness.element();
  harness.refs.actionRow = harness.element({ height: 50, left: 0, top: 400, width: 900 });
  harness.refs.launcher = harness.element({ height: 40, left: 500, top: 400, width: 100 });
  harness.documentObject.documentElement.append(harness.refs.actionRow, unrelated);
  harness.refs.actionRow.append(harness.refs.launcher);

  assert.equal(harness.controller.ownsNode(harness.root), true);
  assert.equal(harness.controller.ownsNode(harness.dragHandle), true);
  assert.equal(harness.controller.ownsNode(unrelated), false);
  assert.equal(harness.controller.ownsNode(null), false);

  harness.controller.layoutNow({
    anchoredCompact: true,
    inlineCompact: true,
    panelMode: harness.runtime.PANEL_MODES.ANCHORED,
    visible: true,
  });
  const host = harness.controller.getSnapshot().compactHost;
  assert.equal(harness.controller.ownsNode(host), true);
  assert.equal(harness.controller.ownsNode(harness.refs.launcher), false);

  harness.controller.resetMount();
  assert.equal(host.isConnected, false);
  assert.equal(harness.controller.ownsNode(host), true, "removed host mutations remain controller-owned");

  harness.controller.disconnect();
  assert.equal(harness.controller.ownsNode(harness.root), false);
  assert.equal(harness.controller.ownsNode(host), false);
});

test("disconnecting a detached compact subtree never resurrects its stale root", async () => {
  const harness = await createHarness();
  harness.refs.actionRow = harness.element({ height: 50, left: 0, top: 400, width: 900 });
  harness.refs.launcher = harness.element({ height: 40, left: 500, top: 400, width: 100 });
  harness.documentObject.documentElement.append(harness.refs.actionRow);
  harness.refs.actionRow.append(harness.refs.launcher);
  harness.controller.layoutNow({
    anchoredCompact: true,
    inlineCompact: true,
    panelMode: harness.runtime.PANEL_MODES.ANCHORED,
    visible: true,
  });
  const host = harness.controller.getSnapshot().compactHost;
  assert.equal(harness.root.parentElement, host);

  harness.refs.actionRow.remove();
  assert.equal(host.isConnected, false);
  assert.equal(harness.root.isConnected, false);

  harness.controller.disconnect();

  assert.equal(harness.documentObject.documentElement.contains(harness.root), false);
  assert.equal(harness.root.isConnected, false);
  assert.equal(host.isConnected, false);
  assert.equal(harness.root.parentElement, host);
});

test("floating seeding clamps the current rectangle without persisting it", async () => {
  const harness = await createHarness({
    rootRect: { height: 225, left: -100, top: 900, width: 400 },
    viewportHeight: 700,
    viewportWidth: 1000,
  });

  assert.deepEqual(
    plain(harness.controller.ensureFloatingPositionFromCurrentRect()),
    { left: 8, top: 467 }
  );
  assert.deepEqual(
    plain(harness.controller.getSnapshot().playerPosition),
    { left: 8, top: 467 }
  );
  assert.deepEqual(harness.saves, []);
});

test("floating entry preserves a hydrated position instead of overwriting it from anchored geometry", async () => {
  const harness = await createHarness({
    rootRect: { height: 225, left: 20, top: 30, width: 400 },
    viewportHeight: 700,
    viewportWidth: 1000,
  });
  harness.controller.hydrate({
    floatingPlayerPosition: { left: 420, top: 260 },
  });

  assert.deepEqual(
    plain(harness.controller.ensureFloatingPositionFromCurrentRect()),
    { left: 420, top: 260 }
  );
  harness.controller.layoutNow({
    panelMode: harness.runtime.PANEL_MODES.FLOATING,
    visible: true,
  });

  assert.equal(harness.root.style.left, "420px");
  assert.equal(harness.root.style.top, "260px");
  assert.deepEqual(harness.saves, []);
});

test("hidden layout state suppresses direct and resize-triggered frame scheduling", async () => {
  const harness = await createHarness();

  assert.equal(harness.controller.layoutNow({
    panelMode: harness.runtime.PANEL_MODES.FLOATING,
    visible: false,
  }), false);
  assert.equal(harness.controller.schedule(), false);
  harness.windowObject.dispatchEvent({ type: "resize" });
  harness.windowObject.visualViewport.dispatchEvent({ type: "resize" });

  assert.equal(harness.frames.pending.size, 0);
  assert.equal(harness.controller.getSnapshot().framePending, false);
  assert.equal(harness.controller.getSnapshot().view.visible, false);
});

test("resize events coalesce into one frame and cancellation owns that frame", async () => {
  const harness = await createHarness({
    rootRect: { height: 180, left: 0, top: 0, width: 320 },
    viewportHeight: 600,
    viewportWidth: 900,
  });
  harness.controller.layoutNow({
    panelMode: harness.runtime.PANEL_MODES.FLOATING,
    visible: true,
  });
  assert.deepEqual(plain(harness.controller.getSnapshot().playerPosition), { left: 562, top: 332 });

  harness.windowObject.visualViewport.width = 800;
  harness.windowObject.visualViewport.height = 500;
  harness.windowObject.dispatchEvent({ type: "resize" });
  harness.windowObject.visualViewport.dispatchEvent({ type: "resize" });
  assert.equal(harness.frames.pending.size, 1);
  assert.equal(harness.controller.getSnapshot().framePending, true);

  harness.frames.flush();
  assert.equal(harness.controller.getSnapshot().framePending, false);
  assert.deepEqual(plain(harness.controller.getSnapshot().playerPosition), { left: 472, top: 312 });

  assert.equal(harness.controller.schedule(), true);
  const [frameId] = harness.frames.pending.keys();
  assert.equal(harness.controller.cancelScheduledLayout(), true);
  assert.equal(harness.frames.pending.size, 0);
  assert.deepEqual(harness.frames.cancelled, [frameId]);
  assert.equal(harness.controller.cancelScheduledLayout(), false);
});

test("floating drag clamps, captures the pointer, and persists on cancel", async () => {
  const harness = await createHarness({
    rootRect: { height: 200, left: 100, top: 100, width: 400 },
  });
  harness.controller.hydrate({
    floatingPlayerPosition: { left: 100, top: 100 },
    floatingPlayerSize: { height: 200, width: 400 },
  });
  harness.controller.layoutNow({
    panelMode: harness.runtime.PANEL_MODES.FLOATING,
    visible: true,
  });

  const ignored = pointerEvent("pointerdown", { button: 2, pointerId: 6 });
  harness.dragHandle.dispatchEvent(ignored);
  assert.equal(ignored.defaultPrevented, false);

  const down = pointerEvent("pointerdown", {
    clientX: 150,
    clientY: 130,
    pointerId: 7,
  });
  harness.dragHandle.dispatchEvent(down);
  assert.equal(down.defaultPrevented, true);
  assert.equal(harness.dragHandle.hasPointerCapture(7), true);
  assert.equal(harness.root.classList.contains("is-dragging"), true);
  const keyboardWhilePointerActive = keyEvent("Enter");
  harness.dragHandle.dispatchEvent(keyboardWhilePointerActive);
  assert.equal(keyboardWhilePointerActive.defaultPrevented, false);
  assert.equal(harness.controller.getSnapshot().keyboardMode, null);

  harness.dragHandle.dispatchEvent(pointerEvent("pointermove", {
    clientX: 999,
    clientY: -10,
    pointerId: 7,
  }));
  assert.deepEqual(plain(harness.controller.getSnapshot().playerPosition), { left: 592, top: 8 });

  harness.dragHandle.dispatchEvent(pointerEvent("pointercancel", { pointerId: 7 }));
  assert.equal(harness.dragHandle.hasPointerCapture(7), false);
  assert.equal(harness.root.classList.contains("is-dragging"), false);
  assert.equal(harness.dragHandle.listenerCount("pointermove"), 0);
  assert.deepEqual(harness.saves, [{
    floatingPlayerPosition: { left: 592, top: 8 },
    floatingPlayerSize: { height: 200, width: 400 },
  }]);
});

test("floating top-left resize preserves the opposite corner and persists", async () => {
  const harness = await createHarness({
    rootRect: { height: 240, left: 200, top: 150, width: 400 },
  });
  harness.controller.hydrate({
    floatingPlayerPosition: { left: 200, top: 150 },
    floatingPlayerSize: { height: 240, width: 400 },
  });
  harness.controller.layoutNow({
    panelMode: harness.runtime.PANEL_MODES.FLOATING,
    visible: true,
  });

  harness.resizeHandle.dispatchEvent(pointerEvent("pointerdown", {
    clientX: 200,
    clientY: 150,
    pointerId: 9,
  }));
  harness.resizeHandle.dispatchEvent(pointerEvent("pointermove", {
    clientX: 100,
    clientY: 90,
    pointerId: 9,
  }));

  const snapshot = harness.controller.getSnapshot();
  assert.deepEqual(plain(snapshot.playerSize), { height: 300, width: 500 });
  assert.deepEqual(plain(snapshot.playerPosition), { left: 100, top: 90 });
  assert.equal(snapshot.playerPosition.left + snapshot.playerSize.width, 600);
  assert.equal(snapshot.playerPosition.top + snapshot.playerSize.height, 390);

  harness.resizeHandle.dispatchEvent(pointerEvent("pointerup", { pointerId: 9 }));
  assert.equal(harness.resizeHandle.hasPointerCapture(9), false);
  assert.equal(harness.root.classList.contains("is-resizing"), false);
  assert.deepEqual(harness.saves, [{
    floatingPlayerPosition: { left: 100, top: 90 },
    floatingPlayerSize: { height: 300, width: 500 },
  }]);
});

test("keyboard floating drag supports mode entry, coarse and fine arrows, rollback, and commit", async () => {
  const harness = await createHarness({
    rootRect: { height: 200, left: 100, top: 100, width: 400 },
  });
  harness.controller.hydrate({
    floatingPlayerPosition: { left: 100, top: 100 },
    floatingPlayerSize: { height: 200, width: 400 },
  });
  harness.controller.layoutNow({
    panelMode: harness.runtime.PANEL_MODES.FLOATING,
    visible: true,
  });

  const inactiveArrow = keyEvent("ArrowRight");
  harness.dragHandle.dispatchEvent(inactiveArrow);
  assert.equal(inactiveArrow.defaultPrevented, false);
  assert.deepEqual(plain(harness.controller.getSnapshot().playerPosition), { left: 100, top: 100 });

  const enter = keyEvent("Enter");
  harness.dragHandle.dispatchEvent(enter);
  assert.equal(enter.defaultPrevented, true);
  assert.equal(enter.propagationStopped, true);
  assert.equal(harness.controller.getSnapshot().keyboardMode, "drag");
  assert.equal(harness.root.classList.contains("is-dragging"), true);
  assert.equal(harness.dragHandle.getAttribute("aria-pressed"), "true");

  harness.dragHandle.dispatchEvent(keyEvent("ArrowRight"));
  harness.dragHandle.dispatchEvent(keyEvent("ArrowDown", { shiftKey: true }));
  assert.deepEqual(plain(harness.controller.getSnapshot().playerPosition), { left: 110, top: 101 });

  const escape = keyEvent("Escape");
  harness.dragHandle.dispatchEvent(escape);
  assert.equal(escape.propagationStopped, true, "layout Escape must not close the panel");
  assert.deepEqual(plain(harness.controller.getSnapshot().playerPosition), { left: 100, top: 100 });
  assert.equal(harness.controller.getSnapshot().keyboardMode, null);
  assert.equal(harness.root.classList.contains("is-dragging"), false);
  assert.equal(harness.dragHandle.getAttribute("aria-pressed"), "false");
  assert.deepEqual(harness.saves, []);

  harness.dragHandle.dispatchEvent(keyEvent(" "));
  for (let index = 0; index < 20; index += 1) {
    harness.dragHandle.dispatchEvent(keyEvent("ArrowLeft", { repeat: index > 0 }));
  }
  assert.deepEqual(plain(harness.controller.getSnapshot().playerPosition), { left: 8, top: 100 });
  harness.dragHandle.dispatchEvent(keyEvent("Enter"));
  assert.deepEqual(harness.saves, [{
    floatingPlayerPosition: { left: 8, top: 100 },
    floatingPlayerSize: { height: 200, width: 400 },
  }]);
});

test("keyboard drag Home previews a default reset that Escape can undo or Enter can persist", async () => {
  const harness = await createHarness({
    rootRect: { height: 200, left: 100, top: 100, width: 400 },
  });
  harness.controller.hydrate({
    floatingPlayerPosition: { left: 100, top: 100 },
    floatingPlayerSize: { height: 200, width: 400 },
  });
  harness.controller.layoutNow({
    panelMode: harness.runtime.PANEL_MODES.FLOATING,
    visible: true,
  });

  harness.dragHandle.dispatchEvent(keyEvent("Enter"));
  harness.dragHandle.dispatchEvent(keyEvent("Home"));
  assert.equal(harness.controller.getSnapshot().keyboardReset, true);
  assert.deepEqual(plain(harness.controller.getSnapshot().playerPosition), { left: 582, top: 412 });
  harness.dragHandle.dispatchEvent(keyEvent("Escape"));
  assert.deepEqual(plain(harness.controller.getSnapshot().playerPosition), { left: 100, top: 100 });
  assert.deepEqual(harness.saves, []);

  harness.dragHandle.dispatchEvent(keyEvent("Enter"));
  harness.dragHandle.dispatchEvent(keyEvent("Home"));
  harness.dragHandle.dispatchEvent(keyEvent("Enter"));
  assert.equal(harness.controller.getSnapshot().playerPosition, null);
  assert.deepEqual(harness.saves, [{
    floatingPlayerPosition: null,
    floatingPlayerSize: { height: 200, width: 400 },
  }]);
});

test("keyboard floating resize preserves its opposite corner and rolls back on blur", async () => {
  const harness = await createHarness({
    rootRect: { height: 240, left: 200, top: 150, width: 400 },
  });
  harness.controller.hydrate({
    floatingPlayerPosition: { left: 200, top: 150 },
    floatingPlayerSize: { height: 240, width: 400 },
  });
  harness.controller.layoutNow({
    panelMode: harness.runtime.PANEL_MODES.FLOATING,
    visible: true,
  });

  harness.resizeHandle.dispatchEvent(keyEvent("Enter"));
  harness.resizeHandle.dispatchEvent(keyEvent("ArrowLeft"));
  harness.resizeHandle.dispatchEvent(keyEvent("ArrowUp", { shiftKey: true }));
  let snapshot = harness.controller.getSnapshot();
  assert.deepEqual(plain(snapshot.playerSize), { height: 241, width: 410 });
  assert.deepEqual(plain(snapshot.playerPosition), { left: 190, top: 149 });
  assert.equal(snapshot.playerPosition.left + snapshot.playerSize.width, 600);
  assert.equal(snapshot.playerPosition.top + snapshot.playerSize.height, 390);
  harness.resizeHandle.dispatchEvent(keyEvent("Enter"));
  assert.deepEqual(harness.saves, [{
    floatingPlayerPosition: { left: 190, top: 149 },
    floatingPlayerSize: { height: 241, width: 410 },
  }]);

  harness.resizeHandle.dispatchEvent(keyEvent("Enter"));
  harness.resizeHandle.dispatchEvent(keyEvent("ArrowRight"));
  harness.resizeHandle.dispatchEvent({ type: "blur" });
  snapshot = harness.controller.getSnapshot();
  assert.deepEqual(plain(snapshot.playerSize), { height: 241, width: 410 });
  assert.deepEqual(plain(snapshot.playerPosition), { left: 190, top: 149 });
  assert.equal(snapshot.keyboardMode, null);
  assert.equal(harness.resizeHandle.getAttribute("aria-pressed"), "false");
  assert.equal(harness.saves.length, 1, "blur rollback must not persist partial geometry");

  harness.resizeHandle.dispatchEvent(keyEvent("Enter"));
  harness.resizeHandle.dispatchEvent(keyEvent("Home"));
  assert.equal(harness.controller.getSnapshot().playerSize, null);
  harness.resizeHandle.dispatchEvent(keyEvent("Escape"));
  snapshot = harness.controller.getSnapshot();
  assert.deepEqual(plain(snapshot.playerSize), { height: 241, width: 410 });
  assert.deepEqual(plain(snapshot.playerPosition), { left: 190, top: 149 });
  assert.equal(harness.saves.length, 1, "Escape restores a resize reset without saving");
});

test("keyboard resize uses anchored and compact clamps plus mode-specific saves and resets", async () => {
  const anchored = await createHarness({
    rootRect: { height: 240, left: 300, top: 200, width: 400 },
    viewportHeight: 800,
    viewportWidth: 1000,
  });
  anchored.refs.launcher = anchored.element({ height: 40, left: 760, top: 600, width: 100 });
  anchored.refs.actionAnchor = anchored.element({ height: 40, left: 450, top: 600, width: 430 });
  anchored.documentObject.documentElement.append(
    anchored.refs.launcher,
    anchored.refs.actionAnchor
  );
  anchored.controller.hydrate({
    anchoredPlayerSize: { height: 240, width: 400 },
  });
  anchored.controller.layoutNow({
    anchoredCompact: false,
    panelMode: anchored.runtime.PANEL_MODES.ANCHORED,
    visible: true,
  });
  anchored.resizeHandle.dispatchEvent(keyEvent(" "));
  anchored.resizeHandle.dispatchEvent(keyEvent("ArrowLeft"));
  anchored.resizeHandle.dispatchEvent(keyEvent("ArrowUp"));
  anchored.resizeHandle.dispatchEvent(keyEvent("Enter"));
  assert.deepEqual(anchored.saves, [{
    anchoredPlayerSize: { height: 250, width: 410 },
  }]);

  const compact = await createHarness({
    rootRect: { height: 80, left: 400, top: 400, width: 360 },
    viewportHeight: 700,
    viewportWidth: 1000,
  });
  compact.refs.actionAnchor = compact.element({ height: 40, left: 500, top: 500, width: 400 });
  compact.documentObject.documentElement.append(compact.refs.actionAnchor);
  compact.controller.hydrate({ compactPlayerWidth: 360 });
  compact.controller.layoutNow({
    anchoredCompact: true,
    inlineCompact: true,
    panelMode: compact.runtime.PANEL_MODES.ANCHORED,
    visible: true,
  });
  compact.resizeHandle.dispatchEvent(keyEvent("Enter"));
  compact.resizeHandle.dispatchEvent(keyEvent("ArrowLeft"));
  const widthAfterHorizontal = compact.controller.getSnapshot().compactWidth;
  compact.resizeHandle.dispatchEvent(keyEvent("ArrowUp"));
  assert.equal(compact.controller.getSnapshot().compactWidth, widthAfterHorizontal);
  compact.resizeHandle.dispatchEvent(keyEvent("Enter"));
  assert.deepEqual(compact.saves, [{ compactPlayerWidth: 370 }]);

  compact.resizeHandle.dispatchEvent(keyEvent("Enter"));
  compact.resizeHandle.dispatchEvent(keyEvent("Home"));
  compact.resizeHandle.dispatchEvent(keyEvent("Enter"));
  assert.deepEqual(compact.saves, [
    { compactPlayerWidth: 370 },
    { compactPlayerWidth: null },
  ]);
});

test("keyboard layout transactions roll back on hide and disconnect with listener cleanup", async () => {
  const harness = await createHarness({
    rootRect: { height: 200, left: 100, top: 100, width: 400 },
  });
  harness.controller.hydrate({ floatingPlayerPosition: { left: 100, top: 100 } });
  harness.controller.layoutNow({
    panelMode: harness.runtime.PANEL_MODES.FLOATING,
    visible: true,
  });
  assert.equal(harness.dragHandle.listenerCount("keydown"), 1);
  assert.equal(harness.dragHandle.listenerCount("blur"), 1);
  assert.equal(harness.resizeHandle.listenerCount("keydown"), 1);
  assert.equal(harness.resizeHandle.listenerCount("blur"), 1);

  harness.dragHandle.dispatchEvent(keyEvent("Enter"));
  harness.dragHandle.dispatchEvent(keyEvent("ArrowRight"));
  harness.controller.layoutNow({ visible: false });
  assert.equal(harness.controller.getSnapshot().keyboardMode, null);
  assert.deepEqual(plain(harness.controller.getSnapshot().playerPosition), { left: 100, top: 100 });
  assert.deepEqual(harness.saves, []);

  harness.controller.layoutNow({ visible: true });
  harness.dragHandle.dispatchEvent(keyEvent("Enter"));
  harness.dragHandle.dispatchEvent(keyEvent("ArrowDown"));
  harness.controller.disconnect();
  assert.equal(harness.controller.getSnapshot().keyboardMode, null);
  assert.deepEqual(plain(harness.controller.getSnapshot().playerPosition), { left: 100, top: 100 });
  assert.equal(harness.dragHandle.listenerCount("keydown"), 0);
  assert.equal(harness.dragHandle.listenerCount("blur"), 0);
  assert.equal(harness.resizeHandle.listenerCount("keydown"), 0);
  assert.equal(harness.resizeHandle.listenerCount("blur"), 0);
  assert.deepEqual(harness.saves, []);
});

test("disconnect cancels transient work without persisting partial pointer state", async () => {
  const harness = await createHarness();
  harness.controller.layoutNow({
    panelMode: harness.runtime.PANEL_MODES.FLOATING,
    visible: true,
  });
  harness.dragHandle.dispatchEvent(pointerEvent("pointerdown", { pointerId: 12 }));
  harness.windowObject.dispatchEvent({ type: "resize" });
  assert.equal(harness.frames.pending.size, 1);

  harness.controller.disconnect();

  const snapshot = harness.controller.getSnapshot();
  assert.equal(snapshot.connected, false);
  assert.equal(snapshot.dragPointerId, null);
  assert.equal(snapshot.framePending, false);
  assert.equal(harness.dragHandle.hasPointerCapture(12), false);
  assert.equal(harness.windowObject.listenerCount("resize"), 0);
  assert.equal(harness.windowObject.visualViewport.listenerCount("resize"), 0);
  assert.equal(harness.frames.pending.size, 0);
  assert.deepEqual(harness.saves, []);
});

test("disconnect and reconnect preserve hydrated geometry without duplicating listeners", async () => {
  const harness = await createHarness();
  harness.controller.hydrate({
    floatingPlayerPosition: { left: 120, top: 140 },
    floatingPlayerSize: { height: 260, width: 420 },
  });
  harness.controller.layoutNow({
    panelMode: harness.runtime.PANEL_MODES.FLOATING,
    visible: true,
  });

  harness.controller.disconnect();
  harness.controller.connect({
    dragHandle: harness.dragHandle,
    resizeHandle: harness.resizeHandle,
    root: harness.root,
  });
  harness.controller.layoutNow({
    panelMode: harness.runtime.PANEL_MODES.FLOATING,
    visible: true,
  });

  assert.deepEqual(
    plain(harness.controller.getSnapshot().playerPosition),
    { left: 120, top: 140 }
  );
  assert.deepEqual(
    plain(harness.controller.getSnapshot().playerSize),
    { height: 260, width: 420 }
  );
  assert.equal(harness.dragHandle.listenerCount("pointerdown"), 1);
  assert.equal(harness.dragHandle.listenerCount("keydown"), 1);
  assert.equal(harness.resizeHandle.listenerCount("pointerdown"), 1);
  assert.equal(harness.resizeHandle.listenerCount("keydown"), 1);
  assert.equal(harness.windowObject.listenerCount("resize"), 1);
  assert.equal(harness.windowObject.visualViewport.listenerCount("resize"), 1);
});

test("content delegates layout ownership and disconnects before tearing down the view", async () => {
  const source = await contentSourcePromise;

  assert.match(source, /createPlayerLayoutController\(\{/);
  assert.match(source, /playerLayout\.hydrate\(state\.settings\)/);
  assert.match(
    source,
    /playerLayout\.connect\(\{[\s\S]*?dragHandle: elements\.dragHandle,[\s\S]*?resizeHandle: elements\.resizeHandle,[\s\S]*?root: elements\.root/
  );
  assert.match(source, /playerLayout\.ownsNode\(element\)/);
  assert.match(source, /playerLayout\.prepareMount\(/);
  assert.match(source, /playerLayout\.layoutNow\(/);
  assert.match(source, /playerLayout\.ensureFloatingPositionFromCurrentRect\(\)/);
  assert.doesNotMatch(source, /function layoutPlayer\b/);
  assert.doesNotMatch(source, /function handleDragPointerDown\b/);
  assert.doesNotMatch(source, /function handleResizePointerDown\b/);
  assert.doesNotMatch(source, /function ensureCompactHost\b/);
  assert.doesNotMatch(source, /const (?:COMPACT_HOST_ID|DRAG_VIEWPORT_PADDING|RESIZE_MODES)\b/);

  const removeUiStart = source.indexOf("function removeWatchPageUi()");
  const layoutDisconnect = source.indexOf("playerLayout.disconnect();", removeUiStart);
  const viewTeardown = source.indexOf("playerView.teardown();", removeUiStart);
  assert.ok(removeUiStart >= 0);
  assert.ok(layoutDisconnect > removeUiStart);
  assert.ok(viewTeardown > layoutDisconnect);
  assert.doesNotMatch(source, /cancelProgressPointerInteraction|handleProgressPointer/);
});

test("extension and package wiring load and verify the layout controller", async () => {
  const [manifest, packageJson] = await Promise.all([manifestPromise, packagePromise]);
  const scripts = manifest.content_scripts[0].js;
  const layoutIndex = scripts.indexOf("src/player-layout.js");
  const contentIndex = scripts.indexOf("src/content.js");

  assert.ok(layoutIndex >= 0);
  assert.ok(contentIndex > layoutIndex);
  assert.equal(
    packageJson.scripts["test:player-layout"],
    "node --test tests/player-layout.test.mjs"
  );
});
