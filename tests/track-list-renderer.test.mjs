import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadRenderer() {
  const source = await readFile(new URL("../src/track-list-renderer.js", import.meta.url), "utf8");
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return context.TimestampPlayerTrackListRenderer;
}

class FakeClassList {
  classes = new Set();

  toggle(name, force) {
    const enabled = force === undefined ? !this.classes.has(name) : Boolean(force);
    if (enabled) {
      this.classes.add(name);
    } else {
      this.classes.delete(name);
    }
    return enabled;
  }

  contains(name) {
    return this.classes.has(name);
  }
}

class FakeElement {
  constructor(ownerDocument, tagName) {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.className = "";
    this.dataset = {};
    this.disabled = false;
    this.textContent = "";
    this.title = "";
    this.type = "";
  }

  append(...children) {
    for (const child of children) {
      this.insertBefore(child, null);
    }
  }

  insertBefore(child, reference) {
    if (child.parentElement) {
      const previousIndex = child.parentElement.children.indexOf(child);
      if (previousIndex >= 0) {
        child.parentElement.children.splice(previousIndex, 1);
      }
    }

    const referenceIndex = reference ? this.children.indexOf(reference) : -1;
    const insertionIndex = referenceIndex >= 0 ? referenceIndex : this.children.length;
    child.parentElement = this;
    this.children.splice(insertionIndex, 0, child);
    return child;
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
    if (this.contains(this.ownerDocument.activeElement)) {
      this.ownerDocument.activeElement = null;
    }
  }

  contains(element) {
    if (element === this) {
      return true;
    }
    return this.children.some((child) => child.contains(element));
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }
}

class FakeDocument {
  activeElement = null;
  createCount = 0;

  createElement(tagName) {
    this.createCount += 1;
    return new FakeElement(this, tagName);
  }
}

function tracks(titles = ["Opening", "Middle", "Finale"]) {
  const starts = [0, 60, 120];
  return starts.map((start, index) => ({
    end: starts[index + 1] ?? 180,
    index,
    start,
    title: titles[index],
  }));
}

function createFixture(api) {
  const document = new FakeDocument();
  const listElement = new FakeElement(document, "div");
  const renderer = api.createTrackListRenderer({
    document,
    formatTimestamp: (seconds) => `${seconds}s`,
    formatTrackLabel: (track) => track.title,
    listElement,
  });
  return { document, listElement, renderer };
}

test("active and playback-style rerenders preserve focused row identity", async () => {
  const api = await loadRenderer();
  const { document, listElement, renderer } = createFixture(api);
  const initialTracks = tracks();

  assert.equal(renderer.renderCollection(initialTracks), true);
  renderer.renderActive(1);
  const focusedRow = renderer.getRowForIndex(1);
  focusedRow.focus();
  const createdElements = document.createCount;

  for (let update = 0; update < 100; update += 1) {
    renderer.renderActive(update % initialTracks.length);
    renderer.renderCollection(initialTracks.map((track) => ({ ...track })));
  }

  assert.equal(document.createCount, createdElements, "unchanged collections must not create new rows");
  assert.equal(renderer.getRowForIndex(1), focusedRow);
  assert.equal(document.activeElement, focusedRow);
  assert.equal(listElement.children.length, 3);
});

test("same-start title upgrades update keyed rows in place", async () => {
  const api = await loadRenderer();
  const { document, renderer } = createFixture(api);
  renderer.renderCollection(tracks());
  renderer.renderActive(1);
  const middleRow = renderer.getRowForIndex(1);
  middleRow.focus();

  assert.equal(renderer.renderCollection(tracks(["Opening", "Hydrated middle", "Finale"])), true);

  assert.equal(renderer.getRowForIndex(1), middleRow);
  assert.equal(middleRow.children[1].textContent, "Hydrated middle");
  assert.equal(document.activeElement, middleRow);
  assert.equal(middleRow.getAttribute("aria-current"), "true");
});

test("prefix expansion reuses existing buttons and creates only the added row", async () => {
  const api = await loadRenderer();
  const { document, listElement, renderer } = createFixture(api);
  const initial = tracks().slice(0, 2);
  renderer.renderCollection(initial);
  const firstRow = renderer.getRowForIndex(0);
  const secondRow = renderer.getRowForIndex(1);
  secondRow.focus();
  const initialCreateCount = document.createCount;

  renderer.renderCollection(tracks());

  assert.equal(renderer.getRowForIndex(0), firstRow);
  assert.equal(renderer.getRowForIndex(1), secondRow);
  assert.equal(document.createCount - initialCreateCount, 4, "one button and its three spans are added");
  assert.equal(document.activeElement, secondRow);
  assert.equal(listElement.children.length, 3);
});

test("active state updates only the old and new keyed rows", async () => {
  const api = await loadRenderer();
  const { renderer } = createFixture(api);
  renderer.renderCollection(tracks());
  renderer.renderActive(0);
  const first = renderer.getRowForIndex(0);
  const second = renderer.getRowForIndex(1);

  renderer.renderActive(1);

  assert.equal(first.classList.contains("is-active"), false);
  assert.equal(first.getAttribute("aria-current"), null);
  assert.equal(second.classList.contains("is-active"), true);
  assert.equal(second.getAttribute("aria-current"), "true");
});

test("disabled playback state is applied semantically without rebuilding track rows", async () => {
  const api = await loadRenderer();
  const { document, listElement, renderer } = createFixture(api);
  const initialTracks = tracks();
  renderer.renderCollection(initialTracks);
  const initialRows = [...listElement.children];
  const createCount = document.createCount;

  assert.equal(renderer.renderEnabled(false), true);
  assert.ok(initialRows.every((row) => row.disabled));
  assert.equal(renderer.renderEnabled(false), false);

  renderer.renderCollection([...initialTracks, {
    end: 240,
    index: 3,
    start: 180,
    title: "Encore",
  }]);
  assert.equal(renderer.getRowForIndex(3).disabled, true, "new rows inherit disabled state");
  assert.equal(renderer.renderEnabled(true), true);
  assert.ok(listElement.children.every((row) => !row.disabled));
  assert.equal(document.createCount - createCount, 4, "enablement must not rebuild existing rows");
  assert.deepEqual(listElement.children.slice(0, 3), initialRows);
});
