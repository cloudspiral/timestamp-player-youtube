import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadVideoResolver() {
  const [ownershipSource, visibilitySource, source] = await Promise.all([
    readFile(new URL("../src/video-ownership.js", import.meta.url), "utf8"),
    readFile(new URL("../src/dom-visibility.js", import.meta.url), "utf8"),
    readFile(new URL("../src/video-resolver.js", import.meta.url), "utf8"),
  ]);
  const context = vm.createContext({});
  vm.runInContext(ownershipSource, context);
  vm.runInContext(visibilitySource, context);
  vm.runInContext(source, context);
  return context.TimestampPlayerVideoResolver;
}

class FakeClassList {
  constructor(classes = []) {
    this.classes = new Set(classes);
  }

  contains(name) {
    return this.classes.has(name);
  }
}

class FakeElement {
  constructor({
    attributes = {},
    classes = [],
    currentSrc = "",
    duration = NaN,
    isConnected = true,
    readyState = 0,
    rect = { width: 0, height: 0 },
    selectors = [],
  } = {}) {
    this.attributes = new Map(Object.entries(attributes).map(([key, value]) => [key, String(value)]));
    this.classList = new FakeClassList(classes);
    this.currentSrc = currentSrc;
    this.duration = duration;
    this.hidden = false;
    this.inert = false;
    this.isConnected = isConnected;
    this.parentElement = null;
    this.readyState = readyState;
    this.rect = rect;
    this.selectors = new Set(selectors);
    this.src = "";
  }

  append(child) {
    child.parentElement = this;
    return child;
  }

  closest(selector) {
    for (let current = this; current; current = current.parentElement) {
      if (current.matches(selector)) {
        return current;
      }
    }
    return null;
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  matches(selector) {
    return this.selectors.has(selector);
  }
}

class FakeRoot {
  constructor(videos) {
    this.videos = videos;
  }

  querySelectorAll(selector) {
    return selector === "video" ? this.videos : [];
  }
}

function createWatchVideo({
  duration = 600,
  hiddenShell = false,
  isConnected = true,
  mainVideoClass = true,
  playerClasses = [],
  readyState = 4,
  rect = { width: 1280, height: 720 },
  shellVideoId = "album",
} = {}) {
  const shell = new FakeElement({
    attributes: shellVideoId === null ? {} : { "video-id": shellVideoId },
    selectors: ["ytd-watch-flexy"],
  });
  if (hiddenShell) {
    shell.attributes.set("hidden", "");
  }
  const player = shell.append(new FakeElement({
    classes: playerClasses,
    selectors: ["#movie_player", ".html5-video-player"],
  }));
  const video = player.append(new FakeElement({
    classes: mainVideoClass ? ["html5-main-video"] : [],
    currentSrc: "blob:content",
    duration,
    isConnected,
    readyState,
    rect,
    selectors: mainVideoClass
      ? ["video", "video.html5-main-video"]
      : ["video"],
  }));
  return { player, shell, video };
}

function createAuxiliaryVideo(kind) {
  const selector = {
    ad: ".video-ads",
    miniplayer: "ytd-miniplayer",
    preview: "ytd-video-preview",
  }[kind];
  const root = new FakeElement({ selectors: [selector] });
  const video = root.append(new FakeElement({
    classes: ["html5-main-video"],
    currentSrc: `blob:${kind}`,
    duration: 300,
    readyState: 4,
    rect: { width: 640, height: 360 },
    selectors: ["video", "video.html5-main-video"],
  }));
  return video;
}

function createMusicVideo({ mainVideoClass = true, videoId = null } = {}) {
  const playerPage = new FakeElement({
    attributes: videoId === null ? {} : { "video-id": videoId },
    selectors: ["ytmusic-player-page", "#player-page"],
  });
  const player = playerPage.append(new FakeElement({ selectors: ["#movie_player"] }));
  return player.append(new FakeElement({
    classes: mainVideoClass ? ["html5-main-video"] : [],
    currentSrc: "blob:music",
    duration: 480,
    readyState: 4,
    rect: { width: 960, height: 540 },
    selectors: mainVideoClass
      ? ["video", "video.html5-main-video"]
      : ["video"],
  }));
}

function describe(api, video, { hostname = "www.youtube.com", order = 0 } = {}) {
  return api.describeVideoElement(video, {
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    hostname,
    order,
  });
}

test("describes and resolves the active current-video watch player", async () => {
  const api = await loadVideoResolver();
  const { video } = createWatchVideo();
  const descriptor = describe(api, video);
  const resolution = api.selectActiveVideoCandidate([descriptor], {
    hostname: "www.youtube.com",
    videoId: "album",
  });

  assert.equal(descriptor.playerKind, api.VIDEO_PLAYER_KINDS.WATCH);
  assert.equal(descriptor.shellVideoId, "album");
  assert.equal(descriptor.visible, true);
  assert.equal(resolution.element, video);
  assert.equal(resolution.status, api.VIDEO_RESOLUTION_STATUSES.READY);
  assert.equal(resolution.reason, "current-watch-player");
});

test("accepts structurally owned classless Watch and Music videos but rejects unknown globals", async () => {
  const api = await loadVideoResolver();
  const watch = createWatchVideo({ mainVideoClass: false });
  const watchDescriptor = describe(api, watch.video);
  const watchResolution = api.selectActiveVideoCandidate([watchDescriptor], {
    hostname: "www.youtube.com",
    videoId: "album",
  });

  assert.equal(watchDescriptor.isMainVideo, false);
  assert.equal(watchDescriptor.hasPrimaryPlayerStructure, true);
  assert.equal(watchResolution.element, watch.video);
  assert.equal(watchResolution.status, api.VIDEO_RESOLUTION_STATUSES.READY);

  const music = createMusicVideo({ mainVideoClass: false });
  const musicDescriptor = describe(api, music, { hostname: "music.youtube.com" });
  const musicResolution = api.selectActiveVideoCandidate([musicDescriptor], {
    hostname: "music.youtube.com",
    videoId: "album",
  });
  assert.equal(musicDescriptor.isMainVideo, false);
  assert.equal(musicDescriptor.hasPrimaryPlayerStructure, true);
  assert.equal(musicResolution.element, music);
  assert.equal(musicResolution.status, api.VIDEO_RESOLUTION_STATUSES.READY);

  const unknown = new FakeElement({
    currentSrc: "blob:unknown",
    duration: 600,
    readyState: 4,
    rect: { width: 1280, height: 720 },
    selectors: ["video"],
  });
  const unknownDescriptor = describe(api, unknown);
  const unknownResolution = api.selectActiveVideoCandidate([unknownDescriptor], {
    hostname: "www.youtube.com",
    videoId: "album",
  });
  assert.equal(unknownDescriptor.hasPrimaryPlayerStructure, false);
  assert.equal(unknownResolution.status, api.VIDEO_RESOLUTION_STATUSES.NOT_FOUND);
});

test("current-shell ownership outranks stale hidden and wrong-video players", async () => {
  const api = await loadVideoResolver();
  const current = createWatchVideo({ duration: NaN, readyState: 0, rect: { width: 0, height: 0 } });
  const staleHidden = createWatchVideo({ hiddenShell: true, shellVideoId: "old-video" });
  const wrongReady = createWatchVideo({ shellVideoId: "different-video" });
  const resolution = api.selectActiveVideoCandidate([
    describe(api, staleHidden.video, { order: 0 }),
    describe(api, wrongReady.video, { order: 1 }),
    describe(api, current.video, { order: 2 }),
  ], {
    hostname: "www.youtube.com",
    videoId: "album",
  });

  assert.equal(resolution.element, current.video);
  assert.equal(resolution.status, api.VIDEO_RESOLUTION_STATUSES.WAITING_FOR_DURATION);
});

test("explicitly hidden or disconnected current players are not eligible", async () => {
  const api = await loadVideoResolver();
  const hidden = createWatchVideo({ hiddenShell: true });
  const disconnected = createWatchVideo({ isConnected: false });
  const resolution = api.selectActiveVideoCandidate([
    describe(api, hidden.video),
    describe(api, disconnected.video),
  ], {
    hostname: "www.youtube.com",
    videoId: "album",
  });

  assert.equal(resolution.element, null);
  assert.equal(resolution.status, api.VIDEO_RESOLUTION_STATUSES.NOT_FOUND);
});

test("miniplayer, inline preview, and explicit ad videos are rejected", async () => {
  const api = await loadVideoResolver();
  const miniplayer = describe(api, createAuxiliaryVideo("miniplayer"));
  const preview = describe(api, createAuxiliaryVideo("preview"));
  const ad = describe(api, createAuxiliaryVideo("ad"));
  const resolution = api.selectActiveVideoCandidate([miniplayer, preview, ad], {
    hostname: "www.youtube.com",
    videoId: "album",
  });

  assert.equal(miniplayer.playerKind, api.VIDEO_PLAYER_KINDS.MINIPLAYER);
  assert.equal(preview.playerKind, api.VIDEO_PLAYER_KINDS.PREVIEW);
  assert.equal(ad.playerKind, api.VIDEO_PLAYER_KINDS.AD);
  assert.equal(resolution.status, api.VIDEO_RESOLUTION_STATUSES.NOT_FOUND);
});

test("an ad-playing main element blocks controls instead of falling through to a preview", async () => {
  const api = await loadVideoResolver();
  const main = createWatchVideo({ playerClasses: ["ad-showing"] });
  const preview = createAuxiliaryVideo("preview");
  const resolution = api.selectActiveVideoCandidate([
    describe(api, preview, { order: 0 }),
    describe(api, main.video, { order: 1 }),
  ], {
    hostname: "www.youtube.com",
    videoId: "album",
  });

  assert.equal(resolution.element, main.video);
  assert.equal(resolution.status, api.VIDEO_RESOLUTION_STATUSES.AD_PLAYING);
  assert.equal(resolution.reason, "main-player-ad-showing");
});

test("re-resolving one main element tracks midroll ad class transitions", async () => {
  const api = await loadVideoResolver();
  const fixture = createWatchVideo();
  const root = new FakeRoot([fixture.video]);
  const options = {
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    hostname: "www.youtube.com",
    root,
    videoId: "album",
  };

  const ready = api.resolveActiveVideo(options);
  fixture.player.classList.classes.add("ad-showing");
  const ad = api.resolveActiveVideo({ ...options, previousElement: ready.element });
  fixture.player.classList.classes.delete("ad-showing");
  const readyAgain = api.resolveActiveVideo({ ...options, previousElement: ad.element });

  assert.equal(ready.status, api.VIDEO_RESOLUTION_STATUSES.READY);
  assert.equal(ad.status, api.VIDEO_RESOLUTION_STATUSES.AD_PLAYING);
  assert.equal(readyAgain.status, api.VIDEO_RESOLUTION_STATUSES.READY);
  assert.equal(ready.element, fixture.video);
  assert.equal(ad.element, fixture.video);
  assert.equal(readyAgain.element, fixture.video);
});

test("a visible current-player ad outranks an invisible same-video non-ad duplicate", async () => {
  const api = await loadVideoResolver();
  const visibleAd = createWatchVideo({ playerClasses: ["ad-showing"] });
  const invisibleNonAd = createWatchVideo({ rect: { width: 0, height: 0 } });
  const resolution = api.selectActiveVideoCandidate([
    describe(api, invisibleNonAd.video, { order: 0 }),
    describe(api, visibleAd.video, { order: 1 }),
  ], {
    hostname: "www.youtube.com",
    previousElement: invisibleNonAd.video,
    videoId: "album",
  });

  assert.equal(resolution.element, visibleAd.video);
  assert.equal(resolution.status, api.VIDEO_RESOLUTION_STATUSES.AD_PLAYING);
  assert.equal(resolution.reason, "main-player-ad-showing");
});

test("blank watch ownership waits while mismatched ownership is rejected", async () => {
  const api = await loadVideoResolver();
  const pending = createWatchVideo({ shellVideoId: null });
  const mismatched = createWatchVideo({ shellVideoId: "old-video" });
  const pendingResolution = api.selectActiveVideoCandidate([describe(api, pending.video)], {
    hostname: "www.youtube.com",
    videoId: "album",
  });
  const mismatchResolution = api.selectActiveVideoCandidate([describe(api, mismatched.video)], {
    hostname: "www.youtube.com",
    videoId: "album",
  });

  assert.equal(pendingResolution.status, api.VIDEO_RESOLUTION_STATUSES.WAITING_FOR_OWNERSHIP);
  assert.equal(mismatchResolution.status, api.VIDEO_RESOLUTION_STATUSES.NOT_FOUND);
});

test("duration and readiness break ties only within the same ownership class", async () => {
  const api = await loadVideoResolver();
  const noDuration = createWatchVideo({ duration: NaN, readyState: 4 });
  const metadataReady = createWatchVideo({ duration: 600, readyState: 1 });
  let resolution = api.selectActiveVideoCandidate([
    describe(api, noDuration.video, { order: 0 }),
    describe(api, metadataReady.video, { order: 1 }),
  ], {
    hostname: "www.youtube.com",
    videoId: "album",
  });
  assert.equal(resolution.element, metadataReady.video);

  const lessReady = createWatchVideo({ duration: 600, readyState: 1 });
  const moreReady = createWatchVideo({ duration: 600, readyState: 4 });
  resolution = api.selectActiveVideoCandidate([
    describe(api, lessReady.video, { order: 0 }),
    describe(api, moreReady.video, { order: 1 }),
  ], {
    hostname: "www.youtube.com",
    videoId: "album",
  });
  assert.equal(resolution.element, moreReady.video);
});

test("zero and infinite durations remain bound but wait for usable metadata", async () => {
  const api = await loadVideoResolver();

  for (const duration of [0, Infinity]) {
    const fixture = createWatchVideo({ duration, readyState: 4 });
    const resolution = api.selectActiveVideoCandidate([describe(api, fixture.video)], {
      hostname: "www.youtube.com",
      videoId: "album",
    });

    assert.equal(resolution.element, fixture.video);
    assert.equal(resolution.status, api.VIDEO_RESOLUTION_STATUSES.WAITING_FOR_DURATION);
    assert.equal(resolution.reason, "video-duration-unavailable");
  }
});

test("a previously bound element wins an otherwise exact tie", async () => {
  const api = await loadVideoResolver();
  const first = createWatchVideo();
  const previous = createWatchVideo();
  const resolution = api.selectActiveVideoCandidate([
    describe(api, first.video, { order: 0 }),
    describe(api, previous.video, { order: 1 }),
  ], {
    hostname: "www.youtube.com",
    previousElement: previous.video,
    videoId: "album",
  });

  assert.equal(resolution.element, previous.video);
});

test("YouTube Music fallback is hostname scoped and loses to an exact watch shell", async () => {
  const api = await loadVideoResolver();
  const music = createMusicVideo();
  const musicDescriptor = describe(api, music, { hostname: "music.youtube.com" });
  const musicResolution = api.selectActiveVideoCandidate([musicDescriptor], {
    hostname: "music.youtube.com",
    videoId: "album",
  });
  const wrongHostResolution = api.selectActiveVideoCandidate([musicDescriptor], {
    hostname: "www.youtube.com",
    videoId: "album",
  });

  assert.equal(musicResolution.element, music);
  assert.equal(musicResolution.status, api.VIDEO_RESOLUTION_STATUSES.READY);
  assert.equal(musicResolution.reason, "youtube-music-fallback");
  assert.equal(wrongHostResolution.status, api.VIDEO_RESOLUTION_STATUSES.NOT_FOUND);

  const watch = createWatchVideo();
  const exactWatchResolution = api.selectActiveVideoCandidate([
    musicDescriptor,
    describe(api, watch.video, { hostname: "music.youtube.com", order: 1 }),
  ], {
    hostname: "music.youtube.com",
    videoId: "album",
  });
  assert.equal(exactWatchResolution.element, watch.video);
});

test("YouTube Music ownership rejects stale players and prefers the current route ID", async () => {
  const api = await loadVideoResolver();
  const stale = createMusicVideo({ videoId: "previous-song" });
  const current = createMusicVideo({ videoId: "current-song" });
  const unresolved = createMusicVideo();
  const descriptors = [
    describe(api, stale, { hostname: "music.youtube.com", order: 0 }),
    describe(api, unresolved, { hostname: "music.youtube.com", order: 1 }),
    describe(api, current, { hostname: "music.youtube.com", order: 2 }),
  ];
  const resolution = api.selectActiveVideoCandidate(descriptors, {
    hostname: "music.youtube.com",
    previousElement: stale,
    videoId: "current-song",
  });

  assert.equal(descriptors[0].musicVideoId, "previous-song");
  assert.equal(descriptors[2].musicVideoId, "current-song");
  assert.equal(resolution.element, current);
  assert.equal(resolution.status, api.VIDEO_RESOLUTION_STATUSES.READY);
  assert.equal(resolution.reason, "current-music-player");

  const staleOnly = api.selectActiveVideoCandidate([descriptors[0]], {
    hostname: "music.youtube.com",
    videoId: "current-song",
  });
  assert.equal(staleOnly.status, api.VIDEO_RESOLUTION_STATUSES.NOT_FOUND);
});

test("resolveActiveVideo collects candidate elements from a lightweight root", async () => {
  const api = await loadVideoResolver();
  const stale = createWatchVideo({ shellVideoId: "old-video" });
  const current = createWatchVideo();
  const resolution = api.resolveActiveVideo({
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    hostname: "www.youtube.com",
    root: new FakeRoot([stale.video, current.video]),
    videoId: "album",
  });

  assert.equal(resolution.element, current.video);
  assert.equal(resolution.status, api.VIDEO_RESOLUTION_STATUSES.READY);
});
