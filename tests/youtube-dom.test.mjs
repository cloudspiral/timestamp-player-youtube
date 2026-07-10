import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const NodeTypes = Object.freeze({
  ELEMENT_NODE: 1,
  TEXT_NODE: 3,
});
const COMMENT_PIN_BADGE_SELECTOR = [
  "ytd-pinned-comment-badge-renderer",
  "yt-pinned-comment-badge-view-model",
  "#pinned-comment-badge",
].join(",");
const COMMENT_UPLOADER_BADGE_SELECTOR = [
  "ytd-author-comment-badge-renderer",
  "yt-author-comment-badge-view-model",
  "#author-comment-badge",
].join(",");
const COMMENT_VOTE_COUNT_SELECTOR = "#vote-count-middle, [id='vote-count-middle']";
const COMMENT_LIKE_BUTTON_SELECTOR = [
  "ytd-comment-action-buttons-renderer #like-button button[aria-label]",
  "ytd-comment-action-buttons-renderer #like-button[aria-label]",
  "like-button-view-model button[aria-label]",
  "yt-like-button-view-model button[aria-label]",
].join(",");
const VIDEO_OWNER_LINK_SELECTOR =
  "ytd-watch-metadata ytd-video-owner-renderer #channel-name a";
const YOUTUBE_MUSIC_DESCRIPTION_ROOT_SELECTORS = [
  "ytmusic-description-shelf-renderer #description",
  "ytmusic-description-shelf-renderer yt-formatted-string",
  "ytmusic-description-shelf-renderer",
];
const QUIET_DESCRIPTION_SELECTORS = [
  "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-structured-description'] ytd-expandable-video-description-body-renderer",
  "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-structured-description'] ytd-structured-description-content-renderer",
  "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-structured-description']",
];
const DESCRIPTION_TOGGLE_SELECTOR = [
  "ytd-watch-metadata ytd-text-inline-expander #expand",
  "ytd-watch-metadata ytd-text-inline-expander #collapse",
  "ytd-watch-metadata #description-inline-expander #expand",
  "ytd-watch-metadata #description-inline-expander #collapse",
  "ytd-watch-metadata tp-yt-paper-button#expand",
  "ytd-watch-metadata tp-yt-paper-button#collapse",
  "ytd-watch-metadata ytd-text-inline-expander button[aria-expanded]",
  "ytd-watch-metadata #description-inline-expander button[aria-expanded]",
  "ytmusic-description-shelf-renderer #expand",
  "ytmusic-description-shelf-renderer #collapse",
  "ytmusic-description-shelf-renderer tp-yt-paper-button#expand",
  "ytmusic-description-shelf-renderer tp-yt-paper-button#collapse",
  "ytd-watch-metadata ytd-text-inline-expander button",
  "ytd-watch-metadata #description-inline-expander button",
].join(",");
const LOCAL_DESCRIPTION_TOGGLE_SELECTOR = [
  "#expand",
  "#collapse",
  "tp-yt-paper-button#expand",
  "tp-yt-paper-button#collapse",
  "button[aria-expanded]",
  "button",
].join(",");
const DESCRIPTION_EXPANDER_SELECTOR = [
  "ytd-text-inline-expander",
  "#description-inline-expander",
  "ytmusic-description-shelf-renderer",
].join(",");
const ACTION_ROW_SELECTOR = [
  "ytd-watch-metadata #top-level-buttons-computed",
  "ytd-watch-metadata ytd-menu-renderer #top-level-buttons-computed",
  "#above-the-fold #top-level-buttons-computed",
  "ytmusic-player-page #actions",
].join(",");
const COMPACT_ACTION_ANCHOR_SELECTOR = [
  "ytd-watch-metadata #actions",
  "ytd-watch-metadata ytd-menu-renderer",
  "#above-the-fold #actions",
  "ytmusic-player-page #actions",
].join(",");
const SHARE_ACTION_SELECTOR = [
  "ytd-button-renderer#share-button",
  "yt-button-view-model#share-button",
  "button-view-model#share-button",
  "#share-button",
  "[data-button-id='share']",
  "[data-action-id='share']",
].join(",");
const NATIVE_TIMESTAMP_SECTION_SELECTOR = [
  "ytd-horizontal-card-list-renderer",
  "ytd-macro-markers-list-renderer",
  "ytd-macro-markers-list-item-renderer",
].join(",");

async function loadYouTubeDom(document, location = {
  href: "https://www.youtube.com/watch?v=album",
}) {
  const source = await readFile(new URL("../src/youtube-dom.js", import.meta.url), "utf8");
  const context = vm.createContext({
    Node: NodeTypes,
    URL,
    document,
    location,
    TimestampPlayerCommentScoring: {
      parseCommentLikeCount(value) {
        const match = String(value).match(/\d+/);
        return match ? Number(match[0]) : null;
      },
    },
    TimestampPlayerNativeTimestamps: {
      isNativeTimestampSectionElement: (element) => element.nativeSection === true,
    },
    TimestampPlayerTimestamps: createTimestampApi(),
  });
  vm.runInContext(source, context);
  return context.TimestampPlayerYouTubeDom.createYouTubeDom({
    Node: NodeTypes,
    document,
    location,
  });
}

function createTimestampApi() {
  function normalizeTitleText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function parseTimestampText(value) {
    const match = String(value || "").match(/(?:^|\s)(\d+):(\d{2})(?=\s|$)/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
  }

  function parseTimeParam(value) {
    const match = String(value || "").match(/^(\d+)(?:s)?$/);
    return match ? Number(match[1]) : NaN;
  }

  function titleFromLineFragment(line, timestamp) {
    const timestampIndex = String(line || "").indexOf(timestamp);
    if (timestampIndex < 0) {
      return "";
    }
    return normalizeTitleText(
      String(line).slice(timestampIndex + timestamp.length).replace(/^[\s:–—-]+/, "")
    );
  }

  return {
    cleanTrackTitle: normalizeTitleText,
    getTextTimestampCandidates(text, origin) {
      return String(text || "").split(/\r?\n/).map((line, lineIndex) => {
        const start = parseTimestampText(line);
        if (!Number.isFinite(start)) {
          return null;
        }
        const timestamp = line.match(/\d+:\d{2}/)?.[0] || "";
        return {
          lineKey: `${origin}:${lineIndex}`,
          start,
          timestampText: timestamp,
          title: titleFromLineFragment(line, timestamp),
        };
      }).filter(Boolean);
    },
    isTimestampRangeEndMarker: (line) => String(line).includes("range-end"),
    lineContainingTimestamp(text, timestamp) {
      return String(text || "").split(/\r?\n/).find((line) => line.includes(timestamp)) || "";
    },
    normalizeTitleText,
    parseTimeParam,
    parseTimestampText,
    titleFromLineFragment,
  };
}

class FakeTextNode {
  constructor(value) {
    this.nodeType = NodeTypes.TEXT_NODE;
    this.nodeValue = value;
    this.parentElement = null;
    this.childNodes = [];
  }
}

class FakeElement {
  constructor(tagName = "div", {
    height = 10,
    id = "",
    innerText,
    textContent = "",
    width = 10,
  } = {}) {
    this.nodeType = NodeTypes.ELEMENT_NODE;
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.textContent = textContent;
    this.innerText = innerText ?? textContent;
    this.parentElement = null;
    this.children = [];
    this.childNodes = [];
    this.attributes = new Map();
    this.queryResults = new Map();
    this.closestResults = new Map();
    this.matchSelectors = new Set();
    this.rect = { height, width };
    this.href = "";
    this.nativeSection = false;
    this.videoId = undefined;
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node.parentElement) {
        node.parentElement.removeChild(node);
      }
      node.parentElement = this;
      this.childNodes.push(node);
      if (node.nodeType === NodeTypes.ELEMENT_NODE) {
        this.children.push(node);
      }
    }
  }

  insertBefore(node, reference) {
    if (node.parentElement) {
      node.parentElement.removeChild(node);
    }
    const childIndex = reference ? this.children.indexOf(reference) : -1;
    const insertionIndex = childIndex >= 0 ? childIndex : this.children.length;
    node.parentElement = this;
    this.children.splice(insertionIndex, 0, node);
    this.childNodes.splice(insertionIndex, 0, node);
  }

  removeChild(node) {
    this.children = this.children.filter((child) => child !== node);
    this.childNodes = this.childNodes.filter((child) => child !== node);
    node.parentElement = null;
  }

  get nextSibling() {
    if (!this.parentElement) {
      return null;
    }
    const index = this.parentElement.children.indexOf(this);
    return this.parentElement.children[index + 1] || null;
  }

  setQuery(selector, results) {
    this.queryResults.set(selector, Array.isArray(results) ? results : [results]);
    return this;
  }

  querySelectorAll(selector) {
    return this.queryResults.get(selector) || [];
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  setClosest(selector, element) {
    this.closestResults.set(selector, element);
    return this;
  }

  closest(selector) {
    if (this.closestResults.has(selector)) {
      return this.closestResults.get(selector);
    }
    for (let current = this; current; current = current.parentElement) {
      if (current.matches(selector)) {
        return current;
      }
    }
    return null;
  }

  matches(selector) {
    return selector === "a" && this.tagName === "A"
      || this.matchSelectors.has(selector);
  }

  contains(node) {
    if (node === this) {
      return true;
    }
    return this.childNodes.some((child) => {
      return child === node
        || child.nodeType === NodeTypes.ELEMENT_NODE && child.contains(node);
    });
  }

  getBoundingClientRect() {
    return this.rect;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }
}

class FakeDocument extends FakeElement {
  constructor() {
    super("document");
  }
}

function createLink({
  container,
  href,
  nativeSection = false,
  text,
  trailingText = "",
}) {
  const link = new FakeElement("a", { textContent: text });
  link.href = href;
  link.nativeSection = nativeSection;
  link.append(new FakeTextNode(text));
  if (container) {
    container.append(link, new FakeTextNode(trailingText));
    link.setClosest(
      ".ytAttributedStringHost, yt-attributed-string, #description, div, li, p",
      container
    );
    link.setClosest(".ytAttributedStringLinkInheritColor", null);
  }
  return link;
}

test("preserves description-control and action-row selector precedence", async () => {
  const document = new FakeDocument();
  const hiddenExpand = new FakeElement("button", { height: 0, textContent: "Más" });
  hiddenExpand.setAttribute("aria-expanded", "false");
  const visibleExpand = new FakeElement("button", { textContent: "Mehr" });
  visibleExpand.setAttribute("aria-expanded", "false");
  const collapse = new FakeElement("button", { id: "collapse" });
  document.setQuery(DESCRIPTION_TOGGLE_SELECTOR, [hiddenExpand, visibleExpand, collapse]);

  const hiddenActionRow = new FakeElement("div", { width: 0 });
  const actionRow = new FakeElement("div");
  const actionAnchor = new FakeElement("div");
  actionRow.setClosest("#actions", actionAnchor);
  document.setQuery(ACTION_ROW_SELECTOR, [hiddenActionRow, actionRow]);
  document.setQuery(COMPACT_ACTION_ANCHOR_SELECTOR, []);

  const dom = await loadYouTubeDom(document);

  assert.equal(dom.findDescriptionExpandButton(), visibleExpand);
  assert.equal(dom.findDescriptionCollapseButton(), collapse);
  assert.equal(dom.findActionRow(), actionRow);
  assert.equal(dom.findCompactActionAnchor(), actionAnchor);
});

test("binds controls and description roots to the current renderer during SPA overlap", async () => {
  const document = new FakeDocument();
  const staleShell = new FakeElement("ytd-watch-flexy");
  staleShell.setAttribute("video-id", "previous-video");
  const currentShell = new FakeElement("ytd-watch-flexy");
  currentShell.setAttribute("video-id", "album");

  const staleExpand = new FakeElement("button", { id: "expand" });
  staleExpand.setClosest("ytd-watch-flexy", staleShell);
  const currentExpand = new FakeElement("button", { id: "expand" });
  currentExpand.setClosest("ytd-watch-flexy", currentShell);
  document.setQuery(DESCRIPTION_TOGGLE_SELECTOR, [staleExpand, currentExpand]);

  const staleActionRow = new FakeElement("div");
  staleActionRow.setClosest("ytd-watch-flexy", staleShell);
  const currentActionRow = new FakeElement("div");
  currentActionRow.setClosest("ytd-watch-flexy", currentShell);
  currentActionRow.setClosest("#actions", currentActionRow);
  document.setQuery(ACTION_ROW_SELECTOR, [staleActionRow, currentActionRow]);
  document.setQuery(COMPACT_ACTION_ANCHOR_SELECTOR, []);

  const staleDescription = new FakeElement("div", { textContent: "0:00 Stale" });
  staleDescription.setClosest("ytd-watch-flexy", staleShell);
  const hiddenCurrentDescription = new FakeElement("div", {
    height: 0,
    textContent: "0:00 Hidden current root",
  });
  hiddenCurrentDescription.setClosest("ytd-watch-flexy", currentShell);
  const currentDescription = new FakeElement("div", {
    textContent: "0:00 Opening\n1:00 Finale",
  });
  currentDescription.setClosest("ytd-watch-flexy", currentShell);
  const hiddenQuietDescription = new FakeElement("div", {
    height: 0,
    textContent: "0:00 Quiet opening\n1:00 Quiet finale",
  });
  hiddenQuietDescription.setClosest("ytd-watch-flexy", currentShell);
  for (const root of [staleDescription, hiddenCurrentDescription, currentDescription]) {
    root.setQuery("a[href*='/watch']", []);
  }
  hiddenQuietDescription.setQuery("a[href*='/watch']", []);
  document.setQuery(
    "ytd-watch-metadata #description-inline-expander #expanded",
    [staleDescription, hiddenCurrentDescription, currentDescription]
  );
  document.setQuery(QUIET_DESCRIPTION_SELECTORS[0], hiddenQuietDescription);

  const staleComment = new FakeElement("ytd-comment-renderer", {
    textContent: "stale comment",
  });
  staleComment.setClosest("ytd-watch-flexy", staleShell);
  staleComment.setClosest("ytd-comment-thread-renderer", null);
  const currentComment = new FakeElement("ytd-comment-renderer", {
    textContent: "current comment",
  });
  currentComment.setClosest("ytd-watch-flexy", currentShell);
  currentComment.setClosest("ytd-comment-thread-renderer", null);
  document.setQuery("ytd-comment-thread-renderer", []);
  document.setQuery(
    "ytd-comment-view-model, ytd-comment-renderer",
    [staleComment, currentComment]
  );

  const dom = await loadYouTubeDom(document);

  assert.equal(dom.findDescriptionExpandButton("album"), currentExpand);
  assert.equal(dom.findActionRow("album"), currentActionRow);
  assert.equal(dom.findCompactActionAnchor("album"), currentActionRow);
  assert.deepEqual(
    Array.from(dom.getDescriptionRoots("album")),
    [hiddenQuietDescription, currentDescription]
  );
  assert.deepEqual(
    Array.from(dom.getQuietDescriptionRoots("album")),
    [hiddenQuietDescription],
    "a connected quiet description stays readable before its panel is opened"
  );
  assert.deepEqual(Array.from(dom.getCommentRoots("album")), [currentComment]);
  assert.equal(dom.findDescriptionExpandButton("missing-video"), null);
  assert.equal(dom.findActionRow("missing-video"), null);
  assert.deepEqual(Array.from(dom.getDescriptionRoots("missing-video")), []);
});

test("explicit current-video timestamp links outrank a hydrating renderer id", async () => {
  const document = new FakeDocument();
  const staleShell = new FakeElement("ytd-watch-flexy");
  staleShell.setAttribute("video-id", "previous-video");
  const pendingShell = new FakeElement("ytd-watch-flexy");
  const staleButCurrent = new FakeElement("div", { textContent: "0:00 Current" });
  const pendingButCurrent = new FakeElement("div", { textContent: "1:00 Current" });
  const mixed = new FakeElement("div", { textContent: "mixed" });
  staleButCurrent.setClosest("ytd-watch-flexy", staleShell);
  pendingButCurrent.setClosest("ytd-watch-flexy", pendingShell);
  mixed.setClosest("ytd-watch-flexy", pendingShell);
  staleButCurrent.setQuery("a[href*='/watch']", createLink({
    href: "https://www.youtube.com/watch?v=album&t=0",
    text: "0:00",
  }));
  pendingButCurrent.setQuery("a[href*='/watch']", createLink({
    href: "https://www.youtube.com/watch?v=album&t=60",
    text: "1:00",
  }));
  mixed.setQuery("a[href*='/watch']", [
    createLink({ href: "https://www.youtube.com/watch?v=album&t=0", text: "0:00" }),
    createLink({ href: "https://www.youtube.com/watch?v=other&t=60", text: "1:00" }),
  ]);
  document.setQuery(
    "ytd-watch-metadata #description-inline-expander #expanded",
    [staleButCurrent, pendingButCurrent, mixed]
  );

  const dom = await loadYouTubeDom(document);

  assert.deepEqual(
    Array.from(dom.getDescriptionRoots("album")),
    [staleButCurrent, pendingButCurrent]
  );
});

test("inserts the launcher after a structural share action without reading English text", async () => {
  const document = new FakeDocument();
  const dom = await loadYouTubeDom(document);
  const actionRow = new FakeElement("div");
  const like = new FakeElement("button", { textContent: "Like" });
  const share = new FakeElement("ytd-button-renderer", { textContent: "Partager" });
  const shareControl = new FakeElement("button", { textContent: "Partager" });
  share.append(shareControl);
  const save = new FakeElement("button", { textContent: "Save" });
  const launcher = new FakeElement("button");
  actionRow.append(like, share, save);
  actionRow.setQuery(SHARE_ACTION_SELECTOR, shareControl);

  dom.insertLauncherButton(actionRow, launcher);
  assert.deepEqual(actionRow.children, [like, share, launcher, save]);

  const rowWithoutShare = new FakeElement("div");
  const secondLauncher = new FakeElement("button");
  const localizedAction = new FakeElement("button", { textContent: "Teilen" });
  rowWithoutShare.append(localizedAction);
  rowWithoutShare.setQuery(SHARE_ACTION_SELECTOR, []);
  dom.insertLauncherButton(rowWithoutShare, secondLauncher);
  assert.equal(rowWithoutShare.children.at(-1), secondLauncher);
});

test("uses centralized YouTube Music description and action fallbacks", async () => {
  const document = new FakeDocument();
  const playerPage = new FakeElement("ytmusic-player-page");
  playerPage.setAttribute("video-id", "album");
  const descriptionRoot = new FakeElement("ytmusic-description-shelf-renderer", {
    innerText: "0:00 Entrada\n1:00 Finale",
    textContent: "0:00 Entrada\n1:00 Finale",
  });
  descriptionRoot.setClosest("ytmusic-player-page", playerPage);
  descriptionRoot.setQuery("a[href*='/watch']", []);
  for (const selector of YOUTUBE_MUSIC_DESCRIPTION_ROOT_SELECTORS) {
    document.setQuery(selector, descriptionRoot);
  }

  const actionRow = new FakeElement("div");
  playerPage.append(actionRow);
  actionRow.setClosest("ytmusic-player-page", playerPage);
  actionRow.setClosest("ytmusic-player-page #actions", actionRow);
  document.setQuery(ACTION_ROW_SELECTOR, actionRow);
  document.setQuery(COMPACT_ACTION_ANCHOR_SELECTOR, actionRow);

  const localizedExpand = new FakeElement("button", { textContent: "Afficher plus" });
  localizedExpand.id = "expand";
  localizedExpand.setAttribute("aria-expanded", "false");
  localizedExpand.setClosest("ytmusic-player-page", playerPage);
  document.setQuery(DESCRIPTION_TOGGLE_SELECTOR, localizedExpand);

  const dom = await loadYouTubeDom(document, {
    href: "https://music.youtube.com/watch?v=album",
  });
  const result = dom.readDescriptionRoot(descriptionRoot, {
    sourceId: "youtube-music",
    videoId: "album",
  });

  assert.deepEqual(Array.from(dom.getDescriptionRoots("album")), [descriptionRoot]);
  assert.equal(dom.findDescriptionExpandButton("album"), localizedExpand);
  assert.equal(dom.findActionRow("album"), actionRow);
  assert.equal(dom.findCompactActionAnchor("album"), actionRow);
  assert.equal(dom.getOwnershipEvidence(descriptionRoot).shellVideoId, "album");
  assert.doesNotMatch(
    DESCRIPTION_TOGGLE_SELECTOR,
    /ytmusic-description-shelf-renderer button\[aria-expanded\]/,
    "Music fallbacks require the dedicated expand/collapse controls"
  );
  assert.deepEqual(Array.from(result.candidates, ({ start }) => start), [0, 60]);
});

test("deduplicates description roots and extracts same-video link candidates", async () => {
  const document = new FakeDocument();
  const quietRoot = new FakeElement("div", { textContent: "Quiet description" });
  const panelRoot = new FakeElement("div", { textContent: "Panel description" });
  const descriptionRoot = new FakeElement("div", { innerText: "Album notes" });
  document.setQuery(QUIET_DESCRIPTION_SELECTORS[0], quietRoot);
  document.setQuery(QUIET_DESCRIPTION_SELECTORS[1], quietRoot);
  document.setQuery(QUIET_DESCRIPTION_SELECTORS[2], panelRoot);
  document.setQuery("ytd-watch-metadata #description-inline-expander #expanded", descriptionRoot);
  document.setQuery("ytd-watch-metadata #description-inline-expander", descriptionRoot);
  document.setQuery("ytd-watch-metadata #description", []);

  const line = new FakeElement("div");
  const currentLink = createLink({
    container: line,
    href: "https://www.youtube.com/watch?v=album&t=120",
    text: "2:00",
    trailingText: " Track C",
  });
  const wrongVideoLink = createLink({
    href: "https://www.youtube.com/watch?v=other&t=180",
    text: "3:00",
  });
  const nativeLink = createLink({
    href: "https://www.youtube.com/watch?v=album&t=240",
    nativeSection: true,
    text: "4:00",
  });
  descriptionRoot.setQuery("a[href*='/watch']", [currentLink, wrongVideoLink, nativeLink]);

  const dom = await loadYouTubeDom(document);
  const roots = dom.getDescriptionRoots();
  const result = dom.readDescriptionRoot(descriptionRoot, {
    sourceId: "fixture",
    videoId: "album",
  });

  assert.deepEqual(Array.from(roots), [quietRoot, panelRoot, descriptionRoot]);
  assert.equal(result.candidateCount, 1);
  assert.equal(result.candidates[0].start, 120);
  assert.equal(result.candidates[0].title, "Track C");
});

test("uses structural collapse state and excludes nested native sections without English headers", async () => {
  const document = new FakeDocument();
  const dom = await loadYouTubeDom(document);
  const collapsed = new FakeElement("div", {
    textContent: "0:00 Intro… Mehr anzeigen",
  });
  const localizedExpand = new FakeElement("button", {
    textContent: "Mehr anzeigen",
  });
  localizedExpand.setAttribute("aria-expanded", "false");
  collapsed.setQuery(LOCAL_DESCRIPTION_TOGGLE_SELECTOR, localizedExpand);

  const withNativeSection = new FakeElement("div", {
    innerText: [
      "0:00 Intro",
      "1:00 Middle",
      "Moments musicaux",
      "2:00 Native duplicate",
    ].join("\n"),
    textContent: [
      "0:00 Intro",
      "1:00 Middle",
      "Moments musicaux",
      "2:00 Native duplicate",
    ].join("\n"),
  });
  const nativeSection = new FakeElement("ytd-horizontal-card-list-renderer");
  nativeSection.nativeSection = true;
  const nestedNativeList = new FakeElement("ytd-macro-markers-list-renderer");
  nestedNativeList.nativeSection = true;
  const nativeLink = createLink({
    href: "https://www.youtube.com/watch?v=album&t=120",
    nativeSection: true,
    text: "2:00",
  });
  nestedNativeList.append(
    new FakeTextNode("Moments musicaux\n"),
    nativeLink,
    new FakeTextNode(" Native duplicate")
  );
  nativeSection.append(nestedNativeList);
  withNativeSection.append(
    new FakeTextNode("0:00 Intro\n1:00 Middle\n"),
    nativeSection
  );
  withNativeSection.setQuery(
    NATIVE_TIMESTAMP_SECTION_SELECTOR,
    [nativeSection, nestedNativeList]
  );
  withNativeSection.setQuery("a[href*='/watch']", nativeLink);

  assert.equal(dom.readDescriptionRoot(collapsed, {
    sourceId: "collapsed",
    videoId: "album",
  }), null);
  assert.equal(dom.isDescriptionRootReadable(collapsed), false);
  const result = dom.readDescriptionRoot(withNativeSection, {
    sourceId: "native-trim",
    videoId: "album",
  });
  assert.deepEqual(Array.from(result.candidates, ({ start }) => start), [0, 60]);
  assert.equal(result.text, "0:00 Intro\n1:00 Middle");
  assert.equal(result.text.includes("Moments musicaux"), false);
});

test("prefers explicit description expansion state over localized truncated text", async () => {
  const document = new FakeDocument();
  const dom = await loadYouTubeDom(document);
  const structurallyCollapsed = new FakeElement("div", {
    textContent: "0:00 Ouverture… Afficher davantage",
  });
  structurallyCollapsed.setAttribute("is-collapsed", "");
  const structurallyExpanded = new FakeElement("div", {
    textContent: "0:00 Ouverture… texte intégral",
  });
  structurallyExpanded.setAttribute("aria-expanded", "true");
  const collapsedWithoutEllipsis = new FakeElement("div", {
    textContent: "Résumé encore incomplet",
  });
  collapsedWithoutEllipsis.setAttribute("aria-expanded", "false");
  const collapsedExpander = new FakeElement("ytd-text-inline-expander");
  collapsedExpander.setAttribute("is-collapsed", "");
  const misleadingExpandedChild = new FakeElement("div", {
    id: "expanded",
    textContent: "0:00 Ouverture… Afficher davantage",
  });
  misleadingExpandedChild.setClosest(DESCRIPTION_EXPANDER_SELECTOR, collapsedExpander);

  assert.equal(dom.readDescriptionRoot(structurallyCollapsed, {
    sourceId: "structurally-collapsed",
    videoId: "album",
  }), null);
  assert.notEqual(dom.readDescriptionRoot(structurallyExpanded, {
    sourceId: "structurally-expanded",
    videoId: "album",
  }), null);
  assert.equal(
    dom.isDescriptionRootReadable(collapsedWithoutEllipsis),
    false,
    "explicit collapsed state must win even when localized truncation has no ellipsis"
  );
  assert.equal(dom.readDescriptionRoot(misleadingExpandedChild, {
    sourceId: "collapsed-parent",
    videoId: "album",
  }), null, "an expanded-content ID cannot override its collapsed expander");
});

test("walks text and BR nodes by line and rejects timestamp range ends", async () => {
  const document = new FakeDocument();
  const descriptionRoot = new FakeElement("div", { innerText: "Album notes" });
  const container = new FakeElement("div");
  const firstLink = createLink({
    href: "https://www.youtube.com/watch?v=album&t=0",
    text: "0:00",
  });
  const rangeEndLink = createLink({
    href: "https://www.youtube.com/watch?v=album&t=90",
    text: "1:30",
  });
  const secondLink = createLink({
    href: "https://www.youtube.com/watch?v=album&t=120",
    text: "2:00",
  });
  for (const link of [firstLink, rangeEndLink, secondLink]) {
    link.setClosest(
      ".ytAttributedStringHost, yt-attributed-string, #description, div, li, p",
      container
    );
    link.setClosest(".ytAttributedStringLinkInheritColor", null);
  }
  container.append(
    new FakeTextNode("Disc one "),
    firstLink,
    new FakeTextNode(" Opening"),
    new FakeElement("br"),
    new FakeTextNode("range-end "),
    rangeEndLink,
    new FakeTextNode(" Boundary"),
    new FakeElement("br"),
    secondLink,
    new FakeTextNode(" Next track")
  );
  descriptionRoot.setQuery(
    "a[href*='/watch']",
    [firstLink, rangeEndLink, secondLink]
  );

  const dom = await loadYouTubeDom(document);
  const result = dom.readDescriptionRoot(descriptionRoot, {
    sourceId: "br-lines",
    videoId: "album",
  });

  assert.deepEqual(Array.from(result.candidates, ({ start }) => start), [0, 120]);
  assert.deepEqual(
    Array.from(result.candidates, ({ lineKey }) => lineKey),
    ["Disc one 0:00 Opening", "2:00 Next track"]
  );
  assert.deepEqual(
    Array.from(result.candidates, ({ title }) => title),
    ["Opening", "Next track"]
  );
});

test("returns raw timestamp-link and watch-shell ownership evidence", async () => {
  const document = new FakeDocument();
  const dom = await loadYouTubeDom(document);
  const shell = new FakeElement("ytd-watch-flexy");
  shell.setAttribute("video-id", " album ");
  const root = new FakeElement("div");
  root.setClosest("ytd-watch-flexy", shell);
  root.setQuery("a[href*='/watch']", [
    createLink({ href: "https://www.youtube.com/watch?v=album&t=0", text: "0:00" }),
    createLink({ href: "https://www.youtube.com/watch?v=other", text: "1:00" }),
    createLink({ href: "https://www.youtube.com/watch?v=ignored", text: "ordinary link" }),
  ]);

  const evidence = dom.getOwnershipEvidence(root);

  assert.deepEqual(Array.from(evidence.linkedVideoIds), ["album", "other"]);
  assert.equal(evidence.shellVideoId, "album");

  shell.attributes.delete("video-id");
  shell.videoId = " property-video ";
  assert.equal(dom.getOwnershipEvidence(root).shellVideoId, "property-video");
});

test("deduplicates visible comments and rejects pin and uploader lookalikes", async () => {
  const document = new FakeDocument();
  const owner = new FakeElement("a", { textContent: "Same Display Name" });
  owner.href = "https://www.youtube.com/channel/UC-real-owner";
  document.setQuery(VIDEO_OWNER_LINK_SELECTOR, owner);

  const thread = new FakeElement("ytd-comment-thread-renderer");
  const comment = new FakeElement("ytd-comment-renderer", {
    innerText: "0:00 Intro\n1:00 Middle\n2:00 Finale",
    textContent: "Pinned by Same Display Name",
  });
  const orphan = new FakeElement("ytd-comment-renderer", { textContent: "ordinary" });
  const hidden = new FakeElement("ytd-comment-renderer", { height: 0 });
  thread.setQuery("ytd-comment-view-model, ytd-comment-renderer", comment);
  comment.setClosest("ytd-comment-thread-renderer", thread);
  orphan.setClosest("ytd-comment-thread-renderer", null);
  hidden.setClosest("ytd-comment-thread-renderer", null);
  document.setQuery("ytd-comment-thread-renderer", thread);
  document.setQuery("ytd-comment-view-model, ytd-comment-renderer", [comment, orphan, hidden]);

  const author = new FakeElement("a", { textContent: "Same Display Name" });
  author.href = "https://www.youtube.com/channel/UC-different-author";
  const body = new FakeElement("div", {
    innerText: "0:00 Intro\n1:00 Middle\n2:00 Finale",
  });
  const hiddenPinBadge = new FakeElement("div", { height: 0 });
  const voteCount = new FakeElement("span", { textContent: "42" });
  comment.setQuery("#author-text", author);
  comment.setQuery("#content-text", body);
  comment.setQuery(COMMENT_PIN_BADGE_SELECTOR, hiddenPinBadge);
  comment.setQuery(COMMENT_UPLOADER_BADGE_SELECTOR, []);
  comment.setQuery(COMMENT_VOTE_COUNT_SELECTOR, voteCount);
  comment.setQuery(COMMENT_LIKE_BUTTON_SELECTOR, []);

  const dom = await loadYouTubeDom(document);
  const roots = dom.getCommentRoots();
  const result = dom.readCommentRoot(comment, { sourceId: "comment-1" });

  assert.deepEqual(Array.from(roots), [comment, orphan]);
  assert.equal(result.authorName, "Same Display Name");
  assert.equal(result.isPinned, false, "hidden badges and body prose are not pin evidence");
  assert.equal(
    result.isUploader,
    false,
    "matching display names cannot override mismatched channel IDs"
  );
  assert.equal(result.likeCount, 42);
  assert.deepEqual(Array.from(result.candidates, ({ start }) => start), [0, 60, 120]);
  assert.equal(dom.isVideoOwner(comment), false);
  assert.equal(dom.isVideoOwner("Same Display Name"), false);
});

test("uses visible pin badges and exact channel IDs or normalized handles", async () => {
  const document = new FakeDocument();
  const owner = new FakeElement("a", { textContent: "Fixture Owner" });
  owner.href = "https://www.youtube.com/channel/UC-fixture-owner";
  document.setQuery(VIDEO_OWNER_LINK_SELECTOR, owner);

  const comment = new FakeElement("ytd-comment-renderer");
  const author = new FakeElement("a", { textContent: "A different display label" });
  author.href = "https://www.youtube.com/channel/UC-fixture-owner";
  const body = new FakeElement("div", { innerText: "0:00 Opening" });
  const pinBadge = new FakeElement("div");
  comment.setQuery("#author-text", author);
  comment.setQuery("#content-text", body);
  comment.setQuery(COMMENT_PIN_BADGE_SELECTOR, pinBadge);
  comment.setQuery(COMMENT_UPLOADER_BADGE_SELECTOR, []);
  comment.setQuery(COMMENT_VOTE_COUNT_SELECTOR, []);
  comment.setQuery(COMMENT_LIKE_BUTTON_SELECTOR, []);

  const dom = await loadYouTubeDom(document);
  const result = dom.readCommentRoot(comment, { sourceId: "matching-channel" });

  assert.equal(result.isPinned, true);
  assert.equal(result.isUploader, true, "matching channel IDs are uploader evidence");

  owner.href = "https://www.youtube.com/@FixtureOwner";
  author.href = "/@fixtureowner";
  assert.equal(dom.isVideoOwner(comment), true, "handles normalize case and relative URLs");
  assert.equal(dom.isVideoOwner("@FIXTUREOWNER"), true);
});

test("uses visible uploader badges and only known like controls", async () => {
  const document = new FakeDocument();
  const comment = new FakeElement("ytd-comment-renderer");
  const hiddenAuthor = new FakeElement("a", {
    height: 0,
    textContent: "Hidden Author",
  });
  const visibleAuthor = new FakeElement("span", { textContent: "Badge Author" });
  const body = new FakeElement("div", { innerText: "0:00 Opening" });
  const authorBadge = new FakeElement("div");
  const hiddenVoteCount = new FakeElement("span", { height: 0, textContent: "444" });
  const hiddenLikeLabel = new FakeElement("button", { height: 0 });
  hiddenLikeLabel.setAttribute("aria-label", "999 likes");
  const unlikeLabel = new FakeElement("button");
  unlikeLabel.setAttribute("aria-label", "Unlike this comment with 222 likes");
  const visibleLikeLabel = new FakeElement("button");
  visibleLikeLabel.setAttribute(
    "aria-label",
    "Like this comment along with 17 other people"
  );
  const replyLabel = new FakeElement("button");
  replyLabel.setAttribute("aria-label", "91 replies");
  const dislikeLabel = new FakeElement("button");
  dislikeLabel.setAttribute("aria-label", "Dislike this comment with 88 votes");
  const menuLabel = new FakeElement("button");
  menuLabel.setAttribute("aria-label", "Menu: show 66 likes");

  comment.setQuery("#author-text", hiddenAuthor);
  comment.setQuery("#author-text span", visibleAuthor);
  comment.setQuery("#content-text", body);
  comment.setQuery(COMMENT_PIN_BADGE_SELECTOR, []);
  comment.setQuery(COMMENT_UPLOADER_BADGE_SELECTOR, authorBadge);
  comment.setQuery(COMMENT_VOTE_COUNT_SELECTOR, hiddenVoteCount);
  comment.setQuery(
    "[aria-label]",
    [replyLabel, dislikeLabel, menuLabel]
  );
  comment.setQuery(
    COMMENT_LIKE_BUTTON_SELECTOR,
    [hiddenLikeLabel, unlikeLabel, visibleLikeLabel]
  );

  const dom = await loadYouTubeDom(document);
  const result = dom.readCommentRoot(comment, { sourceId: "aria-fallback" });

  assert.equal(result.authorName, "Badge Author");
  assert.equal(result.isPinned, false);
  assert.equal(result.isUploader, true);
  assert.equal(result.likeCount, 17);

  const unrelatedOnlyComment = new FakeElement("ytd-comment-renderer");
  unrelatedOnlyComment.setQuery(COMMENT_PIN_BADGE_SELECTOR, []);
  unrelatedOnlyComment.setQuery(COMMENT_UPLOADER_BADGE_SELECTOR, []);
  unrelatedOnlyComment.setQuery(COMMENT_VOTE_COUNT_SELECTOR, []);
  unrelatedOnlyComment.setQuery(COMMENT_LIKE_BUTTON_SELECTOR, []);
  unrelatedOnlyComment.setQuery(
    "[aria-label]",
    [replyLabel, dislikeLabel, menuLabel]
  );
  assert.equal(
    dom.readCommentRoot(unrelatedOnlyComment, { sourceId: "unrelated-labels" }).likeCount,
    null
  );
});

test("extension orchestration delegates localized YouTube DOM interpretation to the adapter", async () => {
  const [content, manifest, packageJson] = await Promise.all([
    readFile(new URL("../src/content.js", import.meta.url), "utf8"),
    readFile(new URL("../manifest.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const scripts = manifest.content_scripts[0].js;
  const adapterIndex = scripts.indexOf("src/youtube-dom.js");

  assert.ok(adapterIndex > scripts.indexOf("src/native-timestamps.js"));
  assert.ok(adapterIndex > scripts.indexOf("src/comment-scoring.js"));
  assert.ok(adapterIndex < scripts.indexOf("src/content.js"));
  assert.match(content, /createYouTubeDom\(\{ Node, document, location \}\)/);
  assert.match(content, /youtubeDom\.getDescriptionRoots\(session\.videoId\)/);
  assert.match(content, /youtubeDom\.getCommentRoots\(session\.videoId\)/);
  assert.match(content, /youtubeDom\.findActionRow\(state\.session\?\.videoId \|\| ""\)/);
  assert.doesNotMatch(content, /function getCommentRoots\b/);
  assert.doesNotMatch(content, /function getTimestampLinkVideoId\b/);
  assert.doesNotMatch(content, /function findActionRow\b/);
  assert.doesNotMatch(content, /includes\(["']share["']\)/i);
  assert.equal(
    packageJson.scripts["test:youtube-dom"],
    "node --test tests/youtube-dom.test.mjs"
  );
});
