import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadVideoOwnership() {
  const source = await readFile(new URL("../src/video-ownership.js", import.meta.url), "utf8");
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return context.TimestampPlayerVideoOwnership;
}

function fakeElement({ attributes = {}, data, videoId } = {}) {
  return {
    data,
    videoId,
    getAttribute(name) {
      return attributes[name] ?? null;
    },
  };
}

test("Watch ownership reads and trims structural shell identifiers", async () => {
  const { getWatchShellVideoId } = await loadVideoOwnership();

  assert.equal(getWatchShellVideoId(fakeElement({
    attributes: { "video-id": " current-watch " },
    videoId: "property-fallback",
  })), "current-watch");
  assert.equal(getWatchShellVideoId(fakeElement({ videoId: " property-watch " })), "property-watch");
  assert.equal(getWatchShellVideoId(fakeElement({ videoId: 123 })), "");
  assert.equal(getWatchShellVideoId(null), "");
});

test("Music ownership follows stable attribute and data fallbacks in order", async () => {
  const { getMusicPlayerVideoId } = await loadVideoOwnership();

  assert.equal(getMusicPlayerVideoId(fakeElement({
    attributes: {
      "data-video-id": "data-attribute",
      "video-id": " video-attribute ",
    },
    data: { videoId: "data-property" },
    videoId: "property",
  })), "video-attribute");
  assert.equal(getMusicPlayerVideoId(fakeElement({
    attributes: { "data-video-id": " data-attribute " },
  })), "data-attribute");
  assert.equal(getMusicPlayerVideoId(fakeElement({ videoId: " property " })), "property");
  assert.equal(getMusicPlayerVideoId(fakeElement({
    data: { videoId: " data-property ", watchEndpoint: { videoId: "endpoint" } },
  })), "data-property");
  assert.equal(getMusicPlayerVideoId(fakeElement({
    data: { watchEndpoint: { videoId: " endpoint " } },
  })), "endpoint");
  assert.equal(getMusicPlayerVideoId(fakeElement({ data: { videoId: 123 } })), "");
  assert.equal(getMusicPlayerVideoId(null), "");
});

test("shared ownership helpers load before every DOM and media consumer", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../manifest.json", import.meta.url), "utf8")
  );
  const scripts = manifest.content_scripts[0].js;
  const ownershipIndex = scripts.indexOf("src/video-ownership.js");

  assert.ok(ownershipIndex >= 0);
  for (const consumer of [
    "src/native-timestamps.js",
    "src/youtube-dom.js",
    "src/video-resolver.js",
  ]) {
    assert.ok(ownershipIndex < scripts.indexOf(consumer), `${consumer} needs video ownership first`);
  }
});
