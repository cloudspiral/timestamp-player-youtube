import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const page = (videoId) => ({ currentVideoEndpoint: { watchEndpoint: { videoId } } });
const script = (videoId) => `var ytInitialData = ${JSON.stringify(page(videoId))};`;
const response = (videoId) => ({ ok: true, text: async () => `<script>${script(videoId)}</script>` });

async function setup({ scripts = [], fetchImpl = () => { throw new Error("Unexpected fetch"); } } = {}) {
  const document = { scripts: scripts.map((textContent) => ({ textContent })) };
  const context = vm.createContext({
    document, URL, AbortController, setTimeout, clearTimeout, fetch: fetchImpl,
    location: { origin: "https://www.youtube.com", href: "https://www.youtube.com/watch?v=video" },
  });
  vm.runInContext(await readFile(new URL("../src/youtube-page-data.js", import.meta.url), "utf8"), context);
  return { ...context.TimestampPlayerYouTubePageData, document };
}

test("current embedded JSON is readable without requests and late scripts supersede stale SPA data", async () => {
  const api = await setup({ scripts: [script("old"), script("video")] });
  const loader = api.createPageDataLoader("video", new AbortController().signal);
  assert.equal(loader.readDocument().initialData.currentVideoEndpoint.watchEndpoint.videoId, "video");
  api.document.scripts.push({ textContent: script("new") });
  const next = api.createPageDataLoader("new", new AbortController().signal);
  assert.equal(next.readDocument().initialData.currentVideoEndpoint.watchEndpoint.videoId, "new");
});

test("chapter and comment consumers share one in-flight current-video watch request", async () => {
  let calls = 0;
  let release;
  const api = await setup({ scripts: [script("stale")], fetchImpl: async (_url, options) => {
    calls++;
    assert.equal(options.redirect, "error");
    return new Promise((resolve) => { release = resolve; });
  } });
  const loader = api.createPageDataLoader("video", new AbortController().signal);
  const chapters = loader.fetchPage();
  const comments = loader.load();
  assert.equal(chapters, comments);
  await new Promise((resolve) => setImmediate(resolve));
  release(response("video"));
  const [a, b] = await Promise.all([chapters, comments]);
  assert.equal(a, b);
  assert.equal(calls, 1);
  await loader.fetchPage();
  assert.equal(calls, 1);
});

test("wrong-video fetched snapshots are rejected", async () => {
  const api = await setup({ fetchImpl: async () => response("stale") });
  const loader = api.createPageDataLoader("video", new AbortController().signal);
  await assert.rejects(loader.fetchPage(), (e) => e.reason === "stale-watch-page-data");
});

test("shared watch requests time out even if fetch ignores its abort signal, with at most one retry", async () => {
  let calls = 0;
  const api = await setup({ fetchImpl: () => { calls++; return new Promise(() => {}); } });
  const loader = api.createPageDataLoader("video", new AbortController().signal, { timeoutMs: 5 });
  await assert.rejects(loader.fetchPage(), (e) => e.reason === "timeout");
  loader.retryTransient();
  await assert.rejects(loader.fetchPage(), (e) => e.reason === "timeout");
  loader.retryTransient();
  await assert.rejects(loader.fetchPage(), (e) => e.reason === "timeout");
  assert.equal(calls, 2);
});

test("navigation abort cancels the shared request and all waiting consumers", async () => {
  const api = await setup({ fetchImpl: () => new Promise(() => {}) });
  const controller = new AbortController();
  const loader = api.createPageDataLoader("video", controller.signal);
  const chapters = loader.fetchPage();
  const comments = loader.load();
  controller.abort();
  await assert.rejects(chapters, (e) => e.reason === "aborted");
  await assert.rejects(comments, (e) => e.reason === "aborted");
});
