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
  assert.equal(harness.resizeHandle.listenerCount("pointerdown"), 1);
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
    plain(harness.controller.seedFloatingFromCurrentRect()),
    { left: 8, top: 467 }
  );
  assert.deepEqual(
    plain(harness.controller.getSnapshot().playerPosition),
    { left: 8, top: 467 }
  );
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
  assert.equal(harness.resizeHandle.listenerCount("pointerdown"), 1);
  assert.equal(harness.windowObject.listenerCount("resize"), 1);
  assert.equal(harness.windowObject.visualViewport.listenerCount("resize"), 1);
});

test("content delegates layout ownership and tears down progress scrubbing before disconnect", async () => {
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
  assert.match(source, /playerLayout\.seedFloatingFromCurrentRect\(\)/);
  assert.doesNotMatch(source, /function layoutPlayer\b/);
  assert.doesNotMatch(source, /function handleDragPointerDown\b/);
  assert.doesNotMatch(source, /function handleResizePointerDown\b/);
  assert.doesNotMatch(source, /function ensureCompactHost\b/);
  assert.doesNotMatch(source, /const (?:COMPACT_HOST_ID|DRAG_VIEWPORT_PADDING|RESIZE_MODES)\b/);

  const removeUiStart = source.indexOf("function removeWatchPageUi()");
  const progressCleanup = source.indexOf("cancelProgressPointerInteraction();", removeUiStart);
  const layoutDisconnect = source.indexOf("playerLayout.disconnect();", removeUiStart);
  const viewTeardown = source.indexOf("playerView.teardown();", removeUiStart);
  assert.ok(removeUiStart >= 0);
  assert.ok(progressCleanup > removeUiStart);
  assert.ok(layoutDisconnect > progressCleanup);
  assert.ok(viewTeardown > layoutDisconnect);
});

test("extension and package wiring load and verify the layout controller", async () => {
  const [manifest, packageJson] = await Promise.all([manifestPromise, packagePromise]);
  const scripts = manifest.content_scripts[0].js;
  const layoutIndex = scripts.indexOf("src/player-layout.js");
  const contentIndex = scripts.indexOf("src/content.js");

  assert.ok(layoutIndex >= 0);
  assert.ok(contentIndex > layoutIndex);
  assert.match(packageJson.scripts["check:js"], /node --check src\/player-layout\.js/);
  assert.match(packageJson.scripts["check:js"], /node --check tests\/player-layout\.test\.mjs/);
  assert.equal(
    packageJson.scripts["test:player-layout"],
    "node --test tests/player-layout.test.mjs"
  );
});
