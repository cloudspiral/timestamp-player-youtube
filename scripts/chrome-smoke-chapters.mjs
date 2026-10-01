import { SMOKE_FAILURE_PATH, SMOKE_MEDIA_PATH, SMOKE_PATH } from "./chrome-smoke-scenarios.mjs";

export const CHAPTER_SMOKE_SCENARIOS = Object.freeze(["direct", "spa"].map((chapterMode) => Object.freeze({
  hostname: "www.youtube.com", kind: "watch", chapterMode, videoId: `chapter-${chapterMode}`,
})));

export function createChapterFixtureHtml(scenario) {
  const titles = ["Opening", "Middle", "Finale"];
  const data = {
    currentVideoEndpoint: { watchEndpoint: { videoId: scenario.videoId } },
    playerOverlays: { playerOverlayRenderer: { decoratedPlayerBarRenderer: { decoratedPlayerBarRenderer: {
      playerBar: { multiMarkersPlayerBarRenderer: { markersMap: [{ key: "AUTO_CHAPTERS", value: {
        chapters: titles.map((title, i) => ({ chapterRenderer: { timeRangeStartMillis: i * 1000, title: { simpleText: title } } })),
      } }] } },
    } } } },
  };
  const markup = `<ytd-page-manager><ytd-watch-flexy video-id="${scenario.videoId}">
    <div id="movie_player" class="html5-video-player"><video class="html5-main-video" preload="auto" src="${SMOKE_MEDIA_PATH}"></video></div>
    <ytd-watch-metadata><div id="description-inline-expander" expanded><div id="expanded">No description timestamps.</div></div>
    <div id="above-the-fold"><div id="title"><h1>Chapter fixture</h1></div><div id="actions"><div id="top-level-buttons-computed"><button>Share</button></div></div></div></ytd-watch-metadata>
    <ytd-comments><ytd-comment-thread-renderer><ytd-comment-renderer><div id="content-text">${titles.map((_title, i) => `<a href="/watch?v=${scenario.videoId}&amp;t=${i}s">0:0${i}</a> Reaction ${i}`).join("<br>")}</div></ytd-comment-renderer></ytd-comment-thread-renderer></ytd-comments>
    </ytd-watch-flexy></ytd-page-manager>`;
  const direct = scenario.chapterMode === "direct";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Chapter discovery smoke</title>
    <style>body, ytd-page-manager, ytd-watch-flexy, ytd-watch-metadata, ytd-comments, ytd-comment-thread-renderer, ytd-comment-renderer, #actions, #top-level-buttons-computed { display:block; min-width:600px; min-height:40px; } video { width:640px; height:360px; } </style>
    ${direct ? `<script>var ytInitialData = ${JSON.stringify(data)};</script>` : ""}
    </head><body>${direct ? markup : "<main>Home</main>"}
    <script>
    const scenario = ${JSON.stringify(scenario)};
    const expected = ${JSON.stringify(titles)};
    const chapterData = ${JSON.stringify(data)};
    const markup = ${JSON.stringify(markup)};
    let reactionSeen = false, injected = ${direct}, reported = false, mediaBefore = null;
    function injectChapters() {
      const video = document.querySelector("video");
      mediaBefore = { time: video.currentTime, paused: video.paused };
      const node = document.createElement("script");
      node.textContent = "var ytInitialData = " + JSON.stringify(chapterData) + ";";
      document.head.appendChild(node);
      injected = true;
      document.dispatchEvent(new CustomEvent("yt-page-data-updated"));
    }
    function report(failed) {
      if (reported) return;
      reported = true;
      const video = document.querySelector("video");
      fetch(failed ? ${JSON.stringify(SMOKE_FAILURE_PATH)} : ${JSON.stringify(SMOKE_PATH)}, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ href: location.href, launcherText: document.getElementById("timestamp-player-launcher")?.textContent,
          chapterMode: scenario.chapterMode, reactionSeen, injected, noChapterPanel: !document.querySelector("ytd-macro-markers-list-renderer"),
          titles: [...document.querySelectorAll(".ts-list-title")].map((n) => n.textContent.trim()),
          playbackPreserved: !mediaBefore || (video.paused === mediaBefore.paused && video.currentTime === mediaBefore.time),
        }),
      });
    }
    window.addEventListener("load", () => {
      if (scenario.chapterMode === "spa") {
        document.body.innerHTML = markup;
        history.pushState({}, "", "/watch?v=" + scenario.videoId);
        document.dispatchEvent(new CustomEvent("yt-navigate-finish", { bubbles: true }));
      }
      setInterval(() => {
        const titles = [...document.querySelectorAll(".ts-list-title")].map((n) => n.textContent.trim());
        if (titles.length === 3 && titles[0] === "Reaction 0") {
          reactionSeen = true;
          if (!injected) injectChapters();
        }
        if (injected && document.getElementById("timestamp-player-launcher") && JSON.stringify(titles) === JSON.stringify(expected)) report(false);
      }, 100);
      setTimeout(() => report(true), 15000);
    });
    </script></body></html>`;
}

export function validateChapterSmokeResult(result, scenario) {
  const url = new URL(result.href);
  if (url.hostname !== scenario.hostname || url.pathname !== "/watch" || url.searchParams.get("v") !== scenario.videoId
    || result.chapterMode !== scenario.chapterMode || !result.launcherText || !result.injected || !result.noChapterPanel
    || !result.playbackPreserved || (scenario.chapterMode === "spa" && !result.reactionSeen)
    || JSON.stringify(result.titles) !== JSON.stringify(["Opening", "Middle", "Finale"])) {
    throw new Error("Chapter smoke did not prove structured chapter selection and playback preservation.");
  }
}
