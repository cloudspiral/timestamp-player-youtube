import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function runtime() {
  const context = vm.createContext({});
  for (const name of ["timestamps", "chapter-data"]) {
    vm.runInContext(await readFile(new URL(`../src/${name}.js`, import.meta.url), "utf8"), context);
  }
  return context.TimestampPlayerChapterData;
}

export function markerPage(key = "AUTO_CHAPTERS", starts = [0, 17000, 294000], videoId = "video") {
  return {
    currentVideoEndpoint: { watchEndpoint: { videoId } },
    playerOverlays: { playerOverlayRenderer: { decoratedPlayerBarRenderer: {
      decoratedPlayerBarRenderer: { playerBar: { multiMarkersPlayerBarRenderer: {
        markersMap: [{ key, value: { chapters: starts.map((start, i) => ({
          chapterRenderer: { timeRangeStartMillis: start, title: { simpleText: ["Intro", "Sora", "Kairi"][i] || `Chapter ${i}` } },
        })) } }],
      } } },
    } } },
  };
}

function panelPage(id, starts = [0, 17, 294]) {
  return {
    currentVideoEndpoint: { watchEndpoint: { videoId: "video" } },
    engagementPanels: [{ engagementPanelSectionListRenderer: {
      targetId: id,
      content: { macroMarkersListRenderer: { contents: starts.map((start, i) => ({
        macroMarkersListItemRenderer: {
          title: { runs: [{ text: `Chapter ${i}` }] }, timeDescription: { simpleText: "9:59" },
          onTap: { watchEndpoint: { videoId: "video", startTimeSeconds: start } },
        },
      })) } },
    } }],
  };
}

test("player marker keys classify manual, automatic and unknown chapter sets without requiring visible cards", async () => {
  const api = await runtime();
  for (const [key, kind] of [["DESCRIPTION_CHAPTERS", "manual"], ["AUTO_CHAPTERS", "automatic"], ["FUTURE_CHAPTERS", "unknown"]]) {
    const [set] = api.extractChapterSets(markerPage(key), "video");
    assert.equal(set.chapterKind, kind);
    assert.equal(set.channel, "chapter-markers");
    const tracks = api.buildChapterTracks(set.candidates, 600);
    assert.deepEqual(Array.from(tracks, (t) => [t.start, t.end, t.title]), [[0, 17, "Intro"], [17, 294, "Sora"], [294, 600, "Kairi"]]);
  }
});

test("the reported video's sanitized metadata produces all 19 automatic chapters", async () => {
  const api = await runtime();
  const fixture = JSON.parse(await readFile(new URL("./fixtures/chapters/reported-video.json", import.meta.url), "utf8"));
  const [set] = api.extractChapterSets(fixture, "vBv5-xa_hgQ");
  const tracks = api.buildChapterTracks(set.candidates, 2729);
  assert.equal(set.chapterKind, "automatic");
  assert.equal(tracks.length, 19);
  assert.equal(tracks[1].title, "Sora");
  assert.equal(tracks[18].start, 2387);
  assert.equal(tracks[18].title, "Hayner, Pence & Olette");
});

test("structured panel uses numeric endpoint times first and clock text only when absent", async () => {
  const api = await runtime();
  const page = panelPage("engagement-panel-macro-markers-description-chapters");
  const items = page.engagementPanels[0].engagementPanelSectionListRenderer.content.macroMarkersListRenderer.contents;
  delete items[2].macroMarkersListItemRenderer.onTap.watchEndpoint.startTimeSeconds;
  items[2].macroMarkersListItemRenderer.timeDescription.simpleText = "4:54";
  const [set] = api.extractChapterSets(page, "video");
  assert.equal(set.chapterKind, "manual");
  assert.deepEqual(Array.from(set.candidates, (c) => c.start), [0, 17, 294]);
  assert.equal(set.complete, true);
});

test("sparse automatic panels remain Key Moments and unrelated panels are ignored", async () => {
  const api = await runtime();
  const [set] = api.extractChapterSets(panelPage("engagement-panel-macro-markers-auto-chapters", [207, 429, 782]), "video");
  assert.equal(set.complete, false);
  assert.equal(api.buildChapterTracks(set.candidates, 900).length, 0);
  assert.equal(api.buildChapterTracks(set.candidates, 900, { requireZero: false }).length, 3);
  assert.equal(api.extractChapterSets(panelPage("engagement-panel-searchable-transcript"), "video").length, 0);
});

test("wrong-video page and panel endpoint evidence are rejected", async () => {
  const api = await runtime();
  assert.equal(api.extractChapterSets(markerPage(), "other-video").length, 0);
  const page = panelPage("engagement-panel-macro-markers-auto-chapters");
  page.engagementPanels[0].engagementPanelSectionListRenderer.content.macroMarkersListRenderer.contents[1].macroMarkersListItemRenderer.onTap.watchEndpoint.videoId = "other";
  assert.equal(api.extractChapterSets(page, "video").length, 0);
});

test("continued panels cannot be promoted to complete chapter lists", async () => {
  const api = await runtime();
  const page = panelPage("engagement-panel-macro-markers-auto-chapters");
  page.engagementPanels[0].engagementPanelSectionListRenderer.content.macroMarkersListRenderer.contents.push({ continuationItemRenderer: {} });
  assert.equal(api.extractChapterSets(page, "video").length, 0);
});

test("structured timelines reject malformed sequences instead of salvaging fragments", async () => {
  const api = await runtime();
  for (const starts of [[0], [1, 2, 3], [0, 30, 20, 40], [0, NaN, 40], [0, -1, 40], [0, 100, 600]]) {
    assert.equal(api.buildChapterTracks(starts.map((start) => ({ start, title: "Chapter" })), 600).length, 0);
  }
  const candidates = [{ start: 0, title: "Intro" }, { start: 0, title: "Intro" }, { start: 1.25, title: "1984 / Live..." }];
  const tracks = api.buildChapterTracks(candidates, 3);
  assert.equal(tracks.length, 2);
  assert.equal(tracks[1].title, "1984 / Live...");
  candidates[1].title = "Conflicting title";
  assert.equal(api.buildChapterTracks(candidates, 3).length, 0);
});

test("malformed renderer shapes and absent markers do not throw", async () => {
  const api = await runtime();
  for (const data of [null, {}, [], markerPage("HEATSEEKER", []), markerPage("AUTO_CHAPTERS", [null, "oops", -10])]) {
    const sets = api.extractChapterSets(data, "video");
    for (const set of sets) assert.equal(api.buildChapterTracks(set.candidates, 600).length, 0);
  }
  const page = markerPage();
  const chapters = page.playerOverlays.playerOverlayRenderer.decoratedPlayerBarRenderer.decoratedPlayerBarRenderer.playerBar.multiMarkersPlayerBarRenderer.markersMap[0].value.chapters;
  chapters[0] = null;
  chapters[1].chapterRenderer.title = { runs: {} };
  const [set] = api.extractChapterSets(page, "video");
  assert.equal(api.buildChapterTracks(set.candidates, 600).length, 0);
});
