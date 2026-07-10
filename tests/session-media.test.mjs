import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadRuntime() {
  const [
    resolverSource,
    sessionSource,
    sessionMediaSource,
    mutationSource,
  ] = await Promise.all([
    readFile(new URL("../src/video-resolver.js", import.meta.url), "utf8"),
    readFile(new URL("../src/watch-session.js", import.meta.url), "utf8"),
    readFile(new URL("../src/session-media.js", import.meta.url), "utf8"),
    readFile(new URL("../src/watch-mutations.js", import.meta.url), "utf8"),
  ]);
  const context = vm.createContext({
    AbortController,
    TimestampPlayerDiscoveryStatus: {
      DISCOVERY_REASONS: { SESSION_ENDED: "session-ended", STARTING: "starting" },
      DISCOVERY_STATUSES: { PENDING: "pending", STOPPED: "stopped" },
      createDiscoveryState: ({ now }) => ({
        changedAt: now,
        reason: "starting",
        status: "pending",
      }),
      transitionDiscoveryState: (_current, status, reason, { now }) => ({
        current: { changedAt: now, reason, status },
      }),
    },
    TimestampPlayerTrackSelection: {
      createTrackSelectionState: () => ({}),
    },
  });
  vm.runInContext(resolverSource, context);
  vm.runInContext(sessionSource, context);
  vm.runInContext(sessionMediaSource, context);
  vm.runInContext(mutationSource, context);
  return {
    media: context.TimestampPlayerSessionMedia,
    mutations: context.TimestampPlayerWatchMutations,
    resolver: context.TimestampPlayerVideoResolver,
    sessions: context.TimestampPlayerWatchSession,
  };
}

class FakeClassList {
  constructor(classes = []) {
    this.classes = new Set(classes);
  }

  add(...names) {
    names.forEach((name) => this.classes.add(name));
  }

  contains(name) {
    return this.classes.has(name);
  }

  remove(...names) {
    names.forEach((name) => this.classes.delete(name));
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
    this.attributes = new Map(Object.entries(attributes).map(([key, value]) => {
      return [key, String(value)];
    }));
    this.children = [];
    this.classList = new FakeClassList(classes);
    this.currentSrc = currentSrc;
    this.duration = duration;
    this.hidden = false;
    this.inert = false;
    this.isConnected = isConnected;
    this.listeners = new Map();
    this.nodeType = 1;
    this.parentElement = null;
    this.readyState = readyState;
    this.rect = rect;
    this.selectors = new Set(selectors);
    this.src = "";
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    if (!listeners.includes(listener)) {
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }
  }

  append(child) {
    child.parentElement = this;
    this.children.push(child);
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

  dispatch(type) {
    const event = { currentTarget: this, target: this, type };
    for (const listener of [...(this.listeners.get(type) || [])]) {
      listener.call(this, event);
    }
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

  listenerCount(type) {
    return this.listeners.get(type)?.length || 0;
  }

  matches(selector) {
    return this.selectors.has(selector);
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

  removeEventListener(type, listener) {
    const listeners = (this.listeners.get(type) || []).filter((item) => item !== listener);
    if (listeners.length) {
      this.listeners.set(type, listeners);
    } else {
      this.listeners.delete(type);
    }
  }
}

class FakeRoot {
  constructor(videos = []) {
    this.videos = videos;
  }

  querySelectorAll(selector) {
    return selector === "video" ? this.videos : [];
  }
}

function createWatchVideo({
  duration = 600,
  readyState = 4,
  shellVideoId = "album",
} = {}) {
  const shell = new FakeElement({
    attributes: shellVideoId === null ? {} : { "video-id": shellVideoId },
    selectors: ["ytd-watch-flexy"],
  });
  const player = shell.append(new FakeElement({
    selectors: ["#movie_player", ".html5-video-player"],
  }));
  const video = player.append(new FakeElement({
    classes: ["html5-main-video"],
    currentSrc: "blob:content",
    duration,
    readyState,
    rect: { width: 1280, height: 720 },
    selectors: ["video", "video.html5-main-video"],
  }));
  return { player, shell, video };
}

function resolve(media, session, root, onEvent = () => {}) {
  return media.resolveAndBindSessionMedia(session, {
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    hostname: "www.youtube.com",
    onEvent,
    root,
    videoId: session.videoId,
  });
}

function assertListenerCounts(video, eventNames, expected) {
  for (const eventName of eventNames) {
    assert.equal(video.listenerCount(eventName), expected, eventName);
  }
}

test("a READY current-watch video owns one direct listener set without scan churn", async () => {
  const { media, resolver, sessions } = await loadRuntime();
  const fixture = createWatchVideo();
  const root = new FakeRoot([fixture.video]);
  const session = sessions.createWatchSession({ generation: 1, videoId: "album" });
  const events = [];
  const onEvent = ({ event, video }) => events.push([event.type, video]);

  const first = resolve(media, session, root, onEvent);
  const firstBinding = session.media.binding;
  assert.equal(first.status, resolver.VIDEO_RESOLUTION_STATUSES.READY);
  assert.equal(media.getReadySessionVideo(session), fixture.video);
  assertListenerCounts(fixture.video, media.SESSION_MEDIA_EVENTS, 1);

  const second = resolve(media, session, root, onEvent);
  assert.equal(second.status, resolver.VIDEO_RESOLUTION_STATUSES.READY);
  assert.equal(session.media.binding, firstBinding, "same-element scans must not rebind");
  assert.equal(session.media.revision, 1);
  assertListenerCounts(fixture.video, media.SESSION_MEDIA_EVENTS, 1);

  for (const eventName of media.SESSION_MEDIA_EVENTS) {
    fixture.video.dispatch(eventName);
  }
  assert.deepEqual(events.map(([eventName]) => eventName), [...media.SESSION_MEDIA_EVENTS]);
  assert.ok(events.every(([, video]) => video === fixture.video));
});

test("midroll ad transitions preserve the bound element but gate READY access", async () => {
  const { media, mutations, resolver, sessions } = await loadRuntime();
  const fixture = createWatchVideo();
  const root = new FakeRoot([fixture.video]);
  const session = sessions.createWatchSession({ generation: 1, videoId: "album" });
  const interests = mutations.getTrackMutationInterests({
    settled: true,
    sourceKind: "description",
  });
  let latestResolution = null;
  const dispatchPlayerMutation = () => {
    const classification = mutations.dispatchWatchMutations([{
      addedNodes: [],
      removedNodes: [],
      target: fixture.player,
    }], {
      interests,
      onMedia: () => {
        latestResolution = resolve(media, session, root);
      },
    });
    assert.equal(classification.discovery, false);
    assert.equal(classification.media, true);
  };

  resolve(media, session, root);
  const binding = session.media.binding;
  fixture.player.classList.add("ad-showing");
  dispatchPlayerMutation();

  assert.equal(latestResolution.status, resolver.VIDEO_RESOLUTION_STATUSES.AD_PLAYING);
  assert.equal(session.media.binding, binding);
  assert.equal(session.media.element, fixture.video);
  assert.equal(media.getReadySessionVideo(session), null);
  assertListenerCounts(fixture.video, media.SESSION_MEDIA_EVENTS, 1);

  fixture.player.classList.remove("ad-showing");
  dispatchPlayerMutation();
  assert.equal(latestResolution.status, resolver.VIDEO_RESOLUTION_STATUSES.READY);
  assert.equal(session.media.binding, binding);
  assert.equal(media.getReadySessionVideo(session), fixture.video);
  assertListenerCounts(fixture.video, media.SESSION_MEDIA_EVENTS, 1);
});

test("player replacement releases the old listener set before the new video takes ownership", async () => {
  const { media, sessions } = await loadRuntime();
  const first = createWatchVideo();
  const second = createWatchVideo();
  const root = new FakeRoot([first.video]);
  const session = sessions.createWatchSession({ generation: 1, videoId: "album" });
  const events = [];
  const onEvent = ({ event, video }) => events.push([event.type, video]);

  resolve(media, session, root, onEvent);
  const firstBinding = session.media.binding;
  first.video.isConnected = false;
  root.videos = [first.video, second.video];
  resolve(media, session, root, onEvent);

  assert.notEqual(session.media.binding, firstBinding);
  assert.equal(session.media.revision, 2);
  assert.equal(media.getReadySessionVideo(session), second.video);
  assertListenerCounts(first.video, media.SESSION_MEDIA_EVENTS, 0);
  assertListenerCounts(second.video, media.SESSION_MEDIA_EVENTS, 1);

  first.video.dispatch("timeupdate");
  second.video.dispatch("timeupdate");
  assert.deepEqual(events, [["timeupdate", second.video]]);
});

test("lost ownership clears the old binding and retains a NOT_FOUND diagnostic", async () => {
  const { media, resolver, sessions } = await loadRuntime();
  const fixture = createWatchVideo();
  const root = new FakeRoot([fixture.video]);
  const session = sessions.createWatchSession({ generation: 1, videoId: "album" });

  resolve(media, session, root);
  fixture.shell.attributes.set("video-id", "different-video");
  const resolution = resolve(media, session, root);

  assert.equal(resolution.status, resolver.VIDEO_RESOLUTION_STATUSES.NOT_FOUND);
  assert.equal(session.media.binding, null);
  assert.equal(session.media.element, null);
  assert.equal(session.media.resolution.status, resolver.VIDEO_RESOLUTION_STATUSES.NOT_FOUND);
  assert.equal(media.getReadySessionVideo(session), null);
  assertListenerCounts(fixture.video, media.SESSION_MEDIA_EVENTS, 0);
});

test("metadata-pending media stays bound and becomes READY without listener replacement", async () => {
  const { media, resolver, sessions } = await loadRuntime();
  const fixture = createWatchVideo({ duration: NaN, readyState: 0 });
  const root = new FakeRoot([fixture.video]);
  const session = sessions.createWatchSession({ generation: 1, videoId: "album" });
  const events = [];

  const waiting = resolve(media, session, root, ({ event }) => events.push(event.type));
  const binding = session.media.binding;
  assert.equal(waiting.status, resolver.VIDEO_RESOLUTION_STATUSES.WAITING_FOR_DURATION);
  assert.equal(media.getReadySessionVideo(session), null);
  assertListenerCounts(fixture.video, media.SESSION_MEDIA_EVENTS, 1);

  fixture.video.duration = 600;
  fixture.video.readyState = 4;
  fixture.video.dispatch("loadedmetadata");
  const ready = resolve(media, session, root);

  assert.deepEqual(events, ["loadedmetadata"]);
  assert.equal(ready.status, resolver.VIDEO_RESOLUTION_STATUSES.READY);
  assert.equal(session.media.binding, binding);
  assert.equal(media.getReadySessionVideo(session), fixture.video);
});

test("SPA ownership hydration re-resolves pending media without waiting for a page refresh", async () => {
  const { media, mutations, resolver, sessions } = await loadRuntime();
  const fixture = createWatchVideo({ shellVideoId: null });
  const root = new FakeRoot([fixture.video]);
  const session = sessions.createWatchSession({ generation: 1, videoId: "album" });
  const waiting = resolve(media, session, root);
  let refreshes = 0;
  let refreshedResolution = null;

  assert.equal(waiting.status, resolver.VIDEO_RESOLUTION_STATUSES.WAITING_FOR_OWNERSHIP);
  assert.equal(media.getReadySessionVideo(session), null);

  fixture.shell.attributes.set("video-id", "album");
  const classification = mutations.dispatchWatchMutations([{
    addedNodes: [],
    removedNodes: [],
    target: fixture.shell,
  }], {
    interests: mutations.getTrackMutationInterests({
      settled: true,
      sourceKind: "description",
    }),
    onMedia: () => {
      refreshes += 1;
      refreshedResolution = resolve(media, session, root);
    },
  });

  assert.equal(classification.discovery, false);
  assert.equal(classification.media, true);
  assert.equal(refreshes, 1);
  assert.equal(refreshedResolution.status, resolver.VIDEO_RESOLUTION_STATUSES.READY);
  assert.equal(media.getReadySessionVideo(session), fixture.video);
});

test("session disposal releases all direct listeners and rejects stale media events", async () => {
  const { media, sessions } = await loadRuntime();
  const fixture = createWatchVideo();
  const root = new FakeRoot([fixture.video]);
  const session = sessions.createWatchSession({ generation: 1, videoId: "album" });
  const events = [];

  resolve(media, session, root, ({ event }) => events.push(event.type));
  sessions.disposeWatchSession(session, "navigation");

  assert.equal(media.getReadySessionVideo(session), null);
  assert.equal(session.media.closed, true);
  assertListenerCounts(fixture.video, media.SESSION_MEDIA_EVENTS, 0);
  fixture.video.dispatch("timeupdate");
  fixture.video.dispatch("play");
  assert.deepEqual(events, []);
});

test("content uses only READY session media and guards playback state before mutation", async () => {
  const source = await readFile(new URL("../src/content.js", import.meta.url), "utf8");

  assert.doesNotMatch(source, /function getVideo\b/);
  assert.doesNotMatch(source, /querySelector\(\s*["']video/);
  assert.doesNotMatch(
    source,
    /document\.(?:add|remove)EventListener\(\s*["'](?:timeupdate|play|pause)["']/
  );
  assert.match(source, /resolveAndBindSessionMedia\(session, \{/);
  assert.match(source, /onMedia: \(\) => scheduleMediaRefresh\(session\)/);
  assert.match(
    source,
    /function playNextTrack[\s\S]*?getReadySessionVideo\(\)[\s\S]*?selectNextTrack\(/
  );
  assert.match(
    source,
    /function handleTrackListClick[\s\S]*?areMediaControlsEnabled\(\)[\s\S]*?playTrack\(/
  );
  assert.match(
    source,
    /function handleSessionMediaEvent[\s\S]*?session\.media\.binding !== binding[\s\S]*?getReadySessionVideo\(session\) !== video/
  );
});

test("extension and package wiring load and verify media ownership before content", async () => {
  const [manifest, packageJson] = await Promise.all([
    readFile(new URL("../manifest.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const scripts = manifest.content_scripts[0].js;
  const resolverIndex = scripts.indexOf("src/video-resolver.js");
  const watchSessionIndex = scripts.indexOf("src/watch-session.js");
  const sessionMediaIndex = scripts.indexOf("src/session-media.js");
  const contentIndex = scripts.indexOf("src/content.js");

  assert.ok(resolverIndex >= 0);
  assert.ok(watchSessionIndex > resolverIndex);
  assert.ok(sessionMediaIndex > watchSessionIndex);
  assert.ok(contentIndex > sessionMediaIndex);
  assert.equal(
    packageJson.scripts["test:session-media"],
    "node --test tests/session-media.test.mjs"
  );
});
