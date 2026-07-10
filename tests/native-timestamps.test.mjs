import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const PAGE_URL = "https://www.youtube.com/watch?v=album";
const NATIVE_SECTION_SELECTOR = [
  "ytd-horizontal-card-list-renderer",
  "ytd-macro-markers-list-renderer",
].join(",");
const NATIVE_ITEM_SELECTOR = [
  "ytd-macro-markers-list-item-renderer",
  "yt-lockup-view-model",
  "[role='listitem']",
  "li",
].join(",");
const NATIVE_CONTAINER_SELECTOR = [
  NATIVE_SECTION_SELECTOR,
  "ytd-macro-markers-list-item-renderer",
].join(",");
const NATIVE_LABEL_SELECTOR = [
  "#details",
  "#title",
  "#video-title",
  ".title",
  ".yt-core-attributed-string",
  "yt-formatted-string",
  "span",
].join(",");

async function loadNativeTimestamps() {
  const timestampSource = await readFile(new URL("../src/timestamps.js", import.meta.url), "utf8");
  const nativeSource = await readFile(new URL("../src/native-timestamps.js", import.meta.url), "utf8");
  const context = vm.createContext({
    location: {
      href: PAGE_URL,
      origin: "https://www.youtube.com",
    },
    URL,
  });
  vm.runInContext(timestampSource, context);
  vm.runInContext(nativeSource, context);
  return context.TimestampPlayerNativeTimestamps;
}

function createTextNode(textContent) {
  return {
    textContent,
    contains() {
      return false;
    },
  };
}

function createNativeLink({
  href,
  itemAttributes = {},
  itemText,
  labelTexts = [],
  linkAttributes = {},
  shellVideoId = "album",
  textContent,
} = {}) {
  const shell = {
    videoId: shellVideoId,
    getAttribute(name) {
      return name === "video-id" ? shellVideoId : null;
    },
  };
  const labels = labelTexts.map(createTextNode);
  const item = {
    innerText: itemText,
    textContent: itemText,
    contains() {
      return false;
    },
    getAttribute(name) {
      return itemAttributes[name] ?? null;
    },
    querySelectorAll(selector) {
      return selector === NATIVE_LABEL_SELECTOR ? labels : [];
    },
  };
  const link = {
    href,
    parentElement: item,
    textContent,
    contains() {
      return false;
    },
    getAttribute(name) {
      return linkAttributes[name] ?? null;
    },
    closest(selector) {
      if (selector === "ytd-watch-flexy") {
        return shellVideoId === null ? null : shell;
      }
      if (selector === NATIVE_ITEM_SELECTOR) {
        return item;
      }
      if (selector === NATIVE_CONTAINER_SELECTOR) {
        return item;
      }
      return null;
    },
  };
  return { item, link, shell };
}

function createRoot(...containerLinks) {
  const containers = containerLinks.map((links) => ({
    querySelectorAll(selector) {
      return selector === "a[href*='/watch']" ? links : [];
    },
  }));
  return {
    querySelectorAll(selector) {
      return selector === NATIVE_CONTAINER_SELECTOR ? containers : [];
    },
  };
}

class FakeDomElement {
  constructor(tagName, { attributes = {}, href = "", text = "" } = {}) {
    this.attributes = new Map(Object.entries(attributes));
    this.children = [];
    this.href = href;
    this.localName = tagName.toLowerCase();
    this.ownText = text;
    this.parentElement = null;
  }

  get innerText() {
    return [this.ownText, ...this.children.map((child) => child.innerText)]
      .filter(Boolean)
      .join(" ");
  }

  get textContent() {
    return [this.ownText, ...this.children.map((child) => child.textContent)]
      .filter(Boolean)
      .join(" ");
  }

  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
    return this;
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  contains(element) {
    let current = element;
    while (current) {
      if (current === this) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }

  getAttribute(name) {
    if (name === "href") {
      return this.href || null;
    }
    return this.attributes.get(name) ?? null;
  }

  matches(selector) {
    return selector.split(",").some((part) => this.matchesSingleSelector(part.trim()));
  }

  matchesSingleSelector(selector) {
    if (selector === "a[href*='/watch']") {
      return this.localName === "a" && this.href.includes("/watch");
    }
    if (selector === "[role='listitem']") {
      return this.getAttribute("role") === "listitem";
    }
    if (selector.startsWith("#")) {
      return this.getAttribute("id") === selector.slice(1);
    }
    if (selector.startsWith(".")) {
      return (this.getAttribute("class") || "").split(/\s+/).includes(selector.slice(1));
    }
    return this.localName === selector;
  }

  querySelectorAll(selector) {
    const matches = [];
    for (const child of this.children) {
      if (child.matches(selector)) {
        matches.push(child);
      }
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }
}

function createDomElement(tagName, options, ...children) {
  return new FakeDomElement(tagName, options).append(...children);
}

function createDomTimestampLink(start, text = start) {
  return createDomElement("a", {
    href: `https://www.youtube.com/watch?v=album&t=${start}`,
    text,
  });
}

function createDomRoot(section) {
  const shell = createDomElement(
    "ytd-watch-flexy",
    { attributes: { "video-id": "album" } },
    section
  );
  return createDomElement("main", {}, shell);
}

function candidateSnapshot(candidate) {
  return {
    lineKey: candidate.lineKey,
    linkedVideoId: candidate.linkedVideoId,
    shellVideoId: candidate.shellVideoId,
    start: candidate.start,
    timestampText: candidate.timestampText,
    title: candidate.title,
  };
}

test("extracts native candidates with explicit video and watch-shell ownership", async () => {
  const api = await loadNativeTimestamps();
  const { link } = createNativeLink({
    href: "https://www.youtube.com/watch?v=album&t=90s",
    itemAttributes: { title: "Opening Full Title" },
    itemText: "1:30 Opening Full Title",
    textContent: "1:30",
  });
  const root = createRoot([link]);
  const candidates = api.getNativeTimestampCandidates("album", root);

  assert.equal(candidates.length, 1);
  assert.deepEqual(candidateSnapshot(candidates[0]), {
    lineKey: "1:30 Opening Full Title",
    linkedVideoId: "album",
    shellVideoId: "album",
    start: 90,
    timestampText: "1:30",
    title: "Opening Full Title",
  });
});

test("uses a valid URL time before visible timestamp text and falls back when absent", async () => {
  const api = await loadNativeTimestamps();
  const withTime = createNativeLink({
    href: "https://www.youtube.com/watch?v=album&t=95s",
    itemAttributes: { title: "URL Time" },
    itemText: "1:30 URL Time",
    textContent: "1:30",
  }).link;
  const textOnly = createNativeLink({
    href: "https://www.youtube.com/watch?v=album",
    itemAttributes: { title: "Text Time" },
    itemText: "2:00 Text Time",
    textContent: "2:00",
  }).link;
  const starts = Array.from(api.getNativeTimestampCandidates("album", createRoot([withTime, textOnly])), ({ start }) => start);

  assert.deepEqual(starts, [95, 120]);
});

test("keeps URL-timed links titled when their visible text is not a clock", async () => {
  const api = await loadNativeTimestamps();
  const titleLink = createNativeLink({
    href: "https://www.youtube.com/watch?v=album&t=0s",
    itemText: "Opening",
    textContent: "Opening",
  }).link;
  const finale = createNativeLink({
    href: "https://www.youtube.com/watch?v=album&t=60s",
    itemText: "Finale",
    textContent: "Finale",
  }).link;

  const candidates = api.getNativeTimestampCandidates(
    "album",
    createRoot([titleLink, finale])
  );

  assert.deepEqual(Array.from(candidates, ({ start, title }) => ({ start, title })), [
    { start: 0, title: "Opening" },
    { start: 60, title: "Finale" },
  ]);
});

test("isolates stale links instead of invalidating current-video native candidates", async () => {
  const api = await loadNativeTimestamps();
  const current = createNativeLink({
    href: "https://www.youtube.com/watch?v=album&t=10s",
    itemText: "0:10 Current",
    textContent: "0:10",
  }).link;
  const stale = createNativeLink({
    href: "https://www.youtube.com/watch?v=old-video&t=20s",
    itemText: "0:20 Stale",
    shellVideoId: "old-video",
    textContent: "0:20",
  }).link;
  const discovery = api.getNativeTimestampDiscovery("album", createRoot([current, stale]));

  assert.equal(discovery.hasMismatchedVideoId, false);
  assert.deepEqual(Array.from(discovery.candidates, ({ start }) => start), [10]);
});

test("reports a relevant stale native section only when no current candidates survive", async () => {
  const api = await loadNativeTimestamps();
  const staleLinks = [20, 40].map((start) => createNativeLink({
    href: `https://www.youtube.com/watch?v=old-video&t=${start}s`,
    itemText: `0:${start} Stale`,
    shellVideoId: "old-video",
    textContent: `0:${start}`,
  }).link);
  const discovery = api.getNativeTimestampDiscovery("album", createRoot(staleLinks));

  assert.equal(discovery.hasMismatchedVideoId, true);
  assert.equal(discovery.candidates.length, 0);
});

test("reports an all-stale structural horizontal section", async () => {
  const api = await loadNativeTimestamps();
  const staleSection = createDomElement(
    "ytd-horizontal-card-list-renderer",
    {},
    createDomElement("a", {
      href: "https://www.youtube.com/watch?v=old-video&t=20s",
      text: "0:20",
    }),
    createDomElement("a", {
      href: "https://www.youtube.com/watch?v=old-video&t=40s",
      text: "0:40",
    })
  );

  const discovery = api.getNativeTimestampDiscovery(
    "album",
    createDomRoot(staleSection)
  );

  assert.equal(discovery.hasMismatchedVideoId, true);
  assert.equal(discovery.candidates.length, 0);
});

test("wrong-video links without a parseable timestamp do not create false mismatch evidence", async () => {
  const api = await loadNativeTimestamps();
  const link = createNativeLink({
    href: "https://www.youtube.com/watch?v=old-video",
    itemText: "Open old video",
    shellVideoId: "old-video",
    textContent: "Open",
  }).link;
  const discovery = api.getNativeTimestampDiscovery("album", createRoot([link]));

  assert.equal(discovery.hasMismatchedVideoId, false);
  assert.equal(discovery.candidates.length, 0);
});

test("relative current-video links retain shell ownership when no video id is explicit", async () => {
  const api = await loadNativeTimestamps();
  const link = createNativeLink({
    href: "https://www.youtube.com/watch?t=45s",
    itemText: "0:45 Relative Link",
    textContent: "0:45",
  }).link;
  const [candidate] = api.getNativeTimestampCandidates("album", createRoot([link]));

  assert.equal(candidate.start, 45);
  assert.equal(candidate.linkedVideoId, "");
  assert.equal(candidate.shellVideoId, "album");
});

test("deduplicates repeated DOM links and equivalent native items", async () => {
  const api = await loadNativeTimestamps();
  const first = createNativeLink({
    href: "https://www.youtube.com/watch?v=album&t=30s",
    itemText: "0:30 Same Item",
    textContent: "0:30",
  }).link;
  const equivalent = createNativeLink({
    href: "https://www.youtube.com/watch?v=album&t=30s",
    itemText: "0:30 Same Item",
    textContent: "0:30",
  }).link;
  const root = createRoot([first], [first, equivalent]);

  assert.equal(api.getNativeTimestampCandidates("album", root).length, 1);
});

test("prefers complete nearby labels and removes timestamp and UI-only labels", async () => {
  const api = await loadNativeTimestamps();
  const complete = createNativeLink({
    href: "https://www.youtube.com/watch?v=album&t=90s",
    itemAttributes: { title: "Opening..." },
    itemText: "1:30 Opening...",
    labelTexts: ["1:30", "Chapters", "Opening Full Title"],
    textContent: "1:30",
  }).link;
  const uiOnly = createNativeLink({
    href: "https://www.youtube.com/watch?v=album&t=120s",
    itemAttributes: { title: "Chapters" },
    itemText: "2:00 Chapters",
    labelTexts: ["2:00", "View all"],
    textContent: "2:00",
  }).link;
  const candidates = api.getNativeTimestampCandidates("album", createRoot([complete, uiOnly]));

  assert.equal(candidates[0].title, "Opening Full Title");
  assert.equal(candidates[1].title, "");
});

test("ignores labels that contain the timestamp link or are contained by it", async () => {
  const api = await loadNativeTimestamps();
  const fixture = createNativeLink({
    href: "https://www.youtube.com/watch?v=album&t=90s",
    itemText: "1:30 Container text",
    textContent: "1:30",
  });
  const ancestorLabel = createTextNode("Wrong ancestor label");
  ancestorLabel.contains = (element) => element === fixture.link;
  const descendantLabel = createTextNode("Wrong descendant label");
  const siblingLabel = createTextNode("Correct sibling label");
  fixture.link.contains = (element) => element === descendantLabel;
  fixture.item.querySelectorAll = (selector) => {
    return selector === NATIVE_LABEL_SELECTOR
      ? [ancestorLabel, descendantLabel, siblingLabel]
      : [];
  };

  const [candidate] = api.getNativeTimestampCandidates("album", createRoot([fixture.link]));

  assert.equal(candidate.title, "Correct sibling label");
});

test("keeps localized labels scoped to separate cards in one horizontal section", async () => {
  const api = await loadNativeTimestamps();
  const firstCard = createDomElement(
    "ytd-macro-markers-list-item-renderer",
    {},
    createDomTimestampLink("0s", "0:00"),
    createDomElement(
      "div",
      { attributes: { id: "details" } },
      createDomElement("yt-formatted-string", { text: "Introducción" })
    )
  );
  const secondCard = createDomElement(
    "ytd-macro-markers-list-item-renderer",
    {},
    createDomTimestampLink("75s", "1:15"),
    createDomElement(
      "div",
      { attributes: { id: "details" } },
      createDomElement("yt-formatted-string", { text: "第一楽章" })
    )
  );
  const section = createDomElement(
    "ytd-horizontal-card-list-renderer",
    {},
    createDomElement("yt-formatted-string", { text: "Moments clés" }),
    firstCard,
    secondCard
  );

  const candidates = api.getNativeTimestampCandidates("album", createDomRoot(section));

  assert.deepEqual(Array.from(candidates, ({ lineKey, title }) => ({ lineKey, title })), [
    { lineKey: "0:00 Introducción", title: "Introducción" },
    { lineKey: "1:15 第一楽章", title: "第一楽章" },
  ]);
  assert.ok(candidates.every(({ lineKey }) => !lineKey.includes("Moments clés")));
  assert.ok(candidates.every(({ lineKey }) => !lineKey.includes("Introducción 第一楽章")));
});

test("does not discover generic list items outside a native timestamp section", async () => {
  const api = await loadNativeTimestamps();
  const nativeSection = createDomElement(
    "ytd-horizontal-card-list-renderer",
    {},
    createDomElement(
      "ytd-macro-markers-list-item-renderer",
      {},
      createDomTimestampLink("5s", "0:05"),
      createDomElement("span", { text: "Native Card" })
    ),
    createDomElement(
      "ytd-macro-markers-list-item-renderer",
      {},
      createDomTimestampLink("35s", "0:35"),
      createDomElement("span", { text: "Second Native Card" })
    )
  );
  const shell = createDomElement(
    "ytd-watch-flexy",
    { attributes: { "video-id": "album" } },
    nativeSection
  );
  const unrelatedItem = createDomElement(
    "yt-lockup-view-model",
    {},
    createDomTimestampLink("90s", "1:30"),
    createDomElement("span", { text: "Unrelated recommendation" })
  );
  const root = createDomElement("main", {}, shell, unrelatedItem);

  const candidates = api.getNativeTimestampCandidates("album", root);

  assert.deepEqual(Array.from(candidates, ({ start, title }) => ({ start, title })), [
    { start: 5, title: "Native Card" },
    { start: 35, title: "Second Native Card" },
  ]);
});

test("ignores hidden and unrelated horizontal timestamp carousels", async () => {
  const api = await loadNativeTimestamps();
  const hidden = createDomElement(
    "ytd-horizontal-card-list-renderer",
    {},
    createDomTimestampLink("10s", "0:10"),
    createDomTimestampLink("20s", "0:20")
  );
  hidden.getBoundingClientRect = () => ({ height: 0, width: 300 });
  const unrelated = createDomElement(
    "ytd-horizontal-card-list-renderer",
    {},
    createDomElement("a", {
      href: "https://www.youtube.com/watch?v=other&t=30s",
      text: "0:30",
    })
  );
  const current = createDomElement(
    "ytd-horizontal-card-list-renderer",
    {},
    createDomElement(
      "li",
      {},
      createDomTimestampLink("0s", "0:00"),
      createDomElement("span", { text: "Opening" })
    ),
    createDomElement(
      "li",
      {},
      createDomTimestampLink("60s", "1:00"),
      createDomElement("span", { text: "Finale" })
    )
  );
  const root = createDomRoot(createDomElement("div", {}, hidden, unrelated, current));

  const discovery = api.getNativeTimestampDiscovery("album", root);

  assert.equal(discovery.hasMismatchedVideoId, false);
  assert.deepEqual(Array.from(discovery.candidates, ({ start, title }) => ({ start, title })), [
    { start: 0, title: "Opening" },
    { start: 60, title: "Finale" },
  ]);
});

test("uses the structural item when an anchor is its child or grandchild", async () => {
  const api = await loadNativeTimestamps();
  const directAnchor = createDomTimestampLink("10s", "0:10");
  const nestedAnchor = createDomTimestampLink("20s", "0:20");
  const directItem = createDomElement(
    "yt-lockup-view-model",
    {},
    directAnchor,
    createDomElement("span", { text: "Direct Parent" })
  );
  const grandparentItem = createDomElement(
    "div",
    { attributes: { role: "listitem" } },
    createDomElement("div", { attributes: { class: "timestamp-pill" } }, nestedAnchor),
    createDomElement("span", { attributes: { class: "title" }, text: "Structural Grandparent" })
  );
  const section = createDomElement(
    "ytd-horizontal-card-list-renderer",
    {},
    directItem,
    grandparentItem
  );

  const candidates = api.getNativeTimestampCandidates("album", createDomRoot(section));

  assert.deepEqual(Array.from(candidates, ({ lineKey, title }) => ({ lineKey, title })), [
    { lineKey: "0:10 Direct Parent", title: "Direct Parent" },
    { lineKey: "0:20 Structural Grandparent", title: "Structural Grandparent" },
  ]);
});

test("falls back to the nearest label-bearing grandparent without widening to the section", async () => {
  const api = await loadNativeTimestamps();
  const anchor = createDomTimestampLink("30s", "0:30");
  const genericCard = createDomElement(
    "div",
    { attributes: { class: "chapter-card" } },
    createDomElement("div", { attributes: { class: "timestamp-pill" } }, anchor),
    createDomElement("div", { attributes: { class: "title" }, text: "Nearest Generic Card" })
  );
  const section = createDomElement(
    "ytd-horizontal-card-list-renderer",
    {},
    createDomElement("span", { text: "Localized section heading" }),
    genericCard,
    createDomElement(
      "div",
      { attributes: { class: "chapter-card" } },
      createDomTimestampLink("45s", "0:45"),
      createDomElement("span", { text: "Other Card" })
    )
  );

  const [candidate] = api.getNativeTimestampCandidates("album", createDomRoot(section));

  assert.equal(candidate.title, "Nearest Generic Card");
  assert.equal(candidate.lineKey, "0:30 Nearest Generic Card");
});

test("fake DOM fixtures remain coupled to the production selector families", async () => {
  const source = await readFile(new URL("../src/native-timestamps.js", import.meta.url), "utf8");

  for (const selector of [
    "ytd-horizontal-card-list-renderer",
    "ytd-macro-markers-list-renderer",
    "ytd-macro-markers-list-item-renderer",
    "yt-lockup-view-model",
    "#details",
    "#video-title",
  ]) {
    assert.match(source, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const itemSelector = source.match(/const NATIVE_TIMESTAMP_ITEM_SELECTOR = \[([\s\S]*?)\]\.join/);
  assert.ok(itemSelector, "the native item selector declaration should remain inspectable");
  assert.doesNotMatch(itemSelector[1], /a\[href/, "the timestamp anchor must never select itself as its item");
  assert.doesNotMatch(itemSelector[1], /ytd-horizontal-card-list-renderer/);
});

test("invalid timestamp fields are ignored by native extraction", async () => {
  const api = await loadNativeTimestamps();
  const invalid = createNativeLink({
    href: "https://www.youtube.com/watch?v=album",
    itemText: "1:99 Invalid",
    textContent: "1:99",
  }).link;

  assert.equal(api.getNativeTimestampCandidates("album", createRoot([invalid])).length, 0);
});

test("identifies whether an element belongs to a native timestamp section", async () => {
  const api = await loadNativeTimestamps();
  const { link } = createNativeLink({
    href: "https://www.youtube.com/watch?v=album&t=10s",
    itemText: "0:10 Track",
    textContent: "0:10",
  });

  assert.equal(api.isNativeTimestampSectionElement(link), true);
  assert.equal(api.isNativeTimestampSectionElement({ closest: () => null }), false);
});
