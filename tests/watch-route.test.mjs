import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadWatchRoute() {
  const source = await readFile(new URL("../src/watch-route.js", import.meta.url), "utf8");
  const context = vm.createContext({ URL });
  vm.runInContext(source, context);
  return context.TimestampPlayerWatchRoute;
}

class FakeEventTarget {
  listeners = new Map();

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) || []) {
      listener({ type });
    }
  }
}

test("content bootstrapped off-watch activates after same-document navigation to a video", async () => {
  const { createWatchRouteController } = await loadWatchRoute();
  const document = new FakeEventTarget();
  const enteredRoutes = [];
  const navigatedRoutes = [];
  const leftRoutes = [];
  const intervals = new Map();
  let nextIntervalId = 1;
  let currentUrl = "https://www.youtube.com/";

  const controller = createWatchRouteController({
    eventTargets: [document],
    getUrl: () => currentUrl,
    onEnter: (route) => enteredRoutes.push(route),
    onLeave: (route) => leftRoutes.push(route),
    onNavigate: (route) => navigatedRoutes.push(route),
    setIntervalFn: (callback) => {
      const id = nextIntervalId;
      nextIntervalId += 1;
      intervals.set(id, callback);
      return id;
    },
    clearIntervalFn: (id) => intervals.delete(id),
  });

  controller.start();
  assert.equal(controller.isActive(), false);
  assert.equal(enteredRoutes.length, 0);

  currentUrl = "https://www.youtube.com/watch?v=first-album";
  document.dispatch("yt-navigate-finish");

  assert.equal(controller.isActive(), true);
  assert.deepEqual(enteredRoutes.map(({ videoId }) => videoId), ["first-album"]);
  assert.equal(enteredRoutes[0].previousUrl, "https://www.youtube.com/");
  assert.equal(navigatedRoutes.length, 0);

  document.dispatch("yt-navigate-finish");
  assert.equal(navigatedRoutes.length, 0, "duplicate events for one video are not new routes");

  currentUrl = "https://www.youtube.com/watch?v=related-album";
  document.dispatch("yt-navigate-finish");

  assert.deepEqual(navigatedRoutes.map(({ videoId }) => videoId), ["related-album"]);
  assert.equal(navigatedRoutes[0].previousVideoId, "first-album");

  currentUrl = "https://www.youtube.com/results?search_query=albums";
  document.dispatch("yt-navigate-finish");

  assert.equal(controller.isActive(), false);
  assert.equal(leftRoutes.length, 1);
  assert.equal(leftRoutes[0].previousVideoId, "related-album");

  controller.stop();
  assert.equal(intervals.size, 0);
});

test("route detection requires a supported /watch URL with a video id", async () => {
  const { getWatchVideoId } = await loadWatchRoute();

  assert.equal(getWatchVideoId("https://www.youtube.com/watch?v=abc123"), "abc123");
  assert.equal(getWatchVideoId("https://music.youtube.com/watch?v=music123"), "music123");
  assert.equal(getWatchVideoId("https://www.youtube.com/watch"), null);
  assert.equal(getWatchVideoId("https://www.youtube.com/results?v=not-a-watch-route"), null);
  assert.equal(getWatchVideoId("https://example.com/watch?v=not-youtube"), null);
});

test("URL polling activates the watch runtime when YouTube omits its navigation event", async () => {
  const { createWatchRouteController } = await loadWatchRoute();
  let currentUrl = "https://www.youtube.com/feed/subscriptions";
  let poll = null;
  const enteredVideoIds = [];
  const controller = createWatchRouteController({
    getUrl: () => currentUrl,
    onEnter: ({ videoId }) => enteredVideoIds.push(videoId),
    setIntervalFn: (callback) => {
      poll = callback;
      return 1;
    },
    clearIntervalFn: () => {
      poll = null;
    },
  });

  controller.start();
  assert.equal(controller.isActive(), false);

  currentUrl = "https://www.youtube.com/watch?v=poll-recovery";
  poll();

  assert.equal(controller.isActive(), true);
  assert.deepEqual(enteredVideoIds, ["poll-recovery"]);

  controller.stop();
  assert.equal(poll, null);
});

test("manifest injects the lightweight route bootstrap on every supported YouTube path", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const [contentScript] = manifest.content_scripts;

  assert.deepEqual(contentScript.matches, [
    "https://www.youtube.com/*",
    "https://music.youtube.com/*",
  ]);
  assert.ok(contentScript.js.includes("src/watch-route.js"));
  assert.ok(
    contentScript.js.indexOf("src/watch-route.js") < contentScript.js.indexOf("src/content.js"),
    "the route bootstrap must load before the content runtime"
  );
});
