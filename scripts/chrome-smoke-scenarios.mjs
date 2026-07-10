export const SMOKE_PATH = "/__timestamp_player_smoke_pass";
export const SMOKE_FAILURE_PATH = "/__timestamp_player_smoke_fail";
export const SMOKE_MEDIA_PATH = "/__timestamp_player_smoke_media.wav";
const EXPECTED_TRACKS = Object.freeze([
  Object.freeze({ time: "0:00", title: "Opening" }),
  Object.freeze({ time: "0:01", title: "Middle" }),
  Object.freeze({ time: "0:02", title: "Finale" }),
]);
const DESCRIPTION_HYDRATION_DELAY_MS = 2_800;
const ACTION_HYDRATION_DELAY_MS = 4_200;
const MIN_DESCRIPTION_HYDRATION_ELAPSED_MS = 2_500;
const MIN_ACTION_HYDRATION_ELAPSED_MS = 4_000;
export const SMOKE_SCENARIOS = Object.freeze([
  Object.freeze({
    actionRowSelector: "#top-level-buttons-computed",
    descriptionSelector: "#description-inline-expander #expanded",
    hostname: "www.youtube.com",
    kind: "watch",
    shellSelector: "ytd-watch-flexy[video-id='smoke-watch-video']",
    videoId: "smoke-watch-video",
  }),
  Object.freeze({
    actionRowSelector: "ytmusic-player-page #actions",
    descriptionSelector: "ytmusic-description-shelf-renderer #description",
    hostname: "music.youtube.com",
    kind: "music",
    shellSelector: "ytmusic-player-page[video-id='smoke-music-video']",
    videoId: "smoke-music-video",
  }),
]);
export const SMOKE_HOSTNAMES = Object.freeze(
  SMOKE_SCENARIOS.map(({ hostname }) => hostname)
);

export function createFixtureHtml(scenario) {
  const scenarioData = {
    actionRowSelector: scenario.actionRowSelector,
    descriptionSelector: scenario.descriptionSelector,
    hostname: scenario.hostname,
    kind: scenario.kind,
    shellSelector: scenario.shellSelector,
    videoId: scenario.videoId,
  };
  const fixtureMarkup = createScenarioMarkup(scenario);
  const expectedTrackTimes = EXPECTED_TRACKS.map(({ time }) => time);
  const expectedTrackTitles = EXPECTED_TRACKS.map(({ title }) => title);
  const watchPath = `/watch?v=${encodeURIComponent(scenario.videoId)}`;
  return `<!doctype html>
<html data-started-off-watch="true" data-smoke-scenario=${JSON.stringify(scenario.kind)}>
  <head>
    <meta charset="utf-8">
    <title>Timestamp Player ${formatScenarioName(scenario)} cold SPA fixture</title>
    <style>
      body, ytd-page-manager, ytd-watch-flexy, ytd-watch-metadata,
      ytmusic-app-layout, ytmusic-player-page, ytmusic-player,
      ytmusic-description-shelf-renderer, #description-inline-expander,
      #description, #expanded, #actions,
      #top-level-buttons-computed { display: block; min-width: 320px; min-height: 32px; }
      #movie_player, video { display: block; width: 640px; height: 360px; }
      #actions, #top-level-buttons-computed { width: 520px; height: 40px; }
    </style>
  </head>
  <body>
    <main id="home">Initial non-watch ${formatScenarioName(scenario)} route</main>
    <script>
      const smokeScenario = ${JSON.stringify(scenarioData)};
      const fixtureMarkup = ${JSON.stringify(fixtureMarkup)};
      const expectedTrackTimes = ${JSON.stringify(expectedTrackTimes)};
      const expectedTrackTitles = ${JSON.stringify(expectedTrackTitles)};
      let reported = false;
      let actionHydrationElapsedMs = null;
      let descriptionHydrationElapsedMs = null;
      let launcherAbsentBeforeWatch = false;
      let playerAbsentBeforeWatch = false;
      let routeEnteredAt = null;
      sessionStorage.setItem("timestamp-player:debug", "1");

      function reportSuccessWhenReady() {
        const launcher = document.getElementById("timestamp-player-launcher");
        const root = document.getElementById("timestamp-player-root");
        const shell = document.querySelector(smokeScenario.shellSelector);
        const description = document.querySelector(smokeScenario.descriptionSelector);
        const actionRow = document.querySelector(smokeScenario.actionRowSelector);
        const video = document.querySelector("video");
        const trackRows = [...root?.querySelectorAll(".ts-list-item") || []];
        const trackTitles = trackRows.map((row) => {
          return row.querySelector(".ts-list-title")?.textContent.trim() || "";
        });
        const trackTimes = trackRows.map((row) => {
          return row.querySelector(".ts-list-time")?.textContent.trim() || "";
        });
        if (
          reported
          || !launcher
          || !root
          || !shell
          || !description
          || !actionRow
          || !video
          || !actionRow.contains(launcher)
          || !video.closest(smokeScenario.shellSelector)
          || JSON.stringify(trackTitles) !== JSON.stringify(expectedTrackTitles)
          || JSON.stringify(trackTimes) !== JSON.stringify(expectedTrackTimes)
          || location.hostname !== smokeScenario.hostname
          || location.pathname !== "/watch"
          || new URLSearchParams(location.search).get("v") !== smokeScenario.videoId
        ) {
          return;
        }
        reported = true;
        fetch(${JSON.stringify(SMOKE_PATH)}, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            href: location.href,
            hostname: location.hostname,
            kind: smokeScenario.kind,
            actionHydrationElapsedMs,
            descriptionHydrationElapsedMs,
            launcherText: launcher.textContent.trim(),
            launcherAbsentBeforeWatch,
            launcherOwnedByActionRow: actionRow.contains(launcher),
            playerAbsentBeforeWatch,
            startedOffWatch: document.documentElement.dataset.startedOffWatch === "true",
            hasActionRow: Boolean(actionRow),
            hasDescription: Boolean(description),
            hasExpectedShell: Boolean(shell),
            trackCount: trackRows.length,
            trackTimes,
            trackTitles,
            videoOwnedByExpectedShell: Boolean(video.closest(smokeScenario.shellSelector))
          })
        });
      }

      function reportFailure() {
        if (reported) {
          return;
        }
        reported = true;
        const video = document.querySelector("video");
        const description = document.querySelector(smokeScenario.descriptionSelector);
        const actionRow = document.querySelector(smokeScenario.actionRowSelector);
        const shell = document.querySelector(smokeScenario.shellSelector);
        const playerRoot = document.getElementById("timestamp-player-root");
        const trackRows = [...playerRoot?.querySelectorAll(".ts-list-item") || []];
        const videoRect = video?.getBoundingClientRect();
        fetch(${JSON.stringify(SMOKE_FAILURE_PATH)}, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            href: location.href,
            hostname: location.hostname,
            kind: smokeScenario.kind,
            actionHydrationElapsedMs,
            descriptionHydrationElapsedMs,
            hasActionRow: Boolean(actionRow),
            hasDescription: Boolean(description),
            hasExpectedShell: Boolean(shell),
            hasLauncher: Boolean(document.getElementById("timestamp-player-launcher")),
            launcherOwnedByActionRow: Boolean(
              actionRow?.contains(document.getElementById("timestamp-player-launcher"))
            ),
            hasPlayerRoot: Boolean(playerRoot),
            hasVideo: Boolean(video),
            descriptionText: description?.innerText || description?.textContent || "",
            documentReadyState: document.readyState,
            playerClassName: playerRoot?.className || "",
            trackCount: trackRows.length,
            trackTimes: trackRows.map((row) => {
              return row.querySelector(".ts-list-time")?.textContent.trim() || "";
            }),
            trackTitles: trackRows.map((row) => {
              return row.querySelector(".ts-list-title")?.textContent.trim() || "";
            }),
            videoDuration: video?.duration,
            videoOwnedByExpectedShell: Boolean(video?.closest(smokeScenario.shellSelector)),
            videoReadyState: video?.readyState,
            videoRect: videoRect ? { width: videoRect.width, height: videoRect.height } : null
          })
        });
      }

      new MutationObserver(reportSuccessWhenReady).observe(document.documentElement, {
        childList: true,
        subtree: true
      });

      function stageElement(selector) {
        const element = document.querySelector(selector);
        if (!element) {
          throw new Error("Smoke fixture could not stage " + selector);
        }
        const marker = document.createComment("staged " + selector);
        element.replaceWith(marker);
        return () => marker.replaceWith(element);
      }

      window.addEventListener("load", () => {
        setTimeout(() => {
          document.body.innerHTML = fixtureMarkup;
          const restoreDescription = stageElement(smokeScenario.descriptionSelector);
          const restoreActions = stageElement(smokeScenario.actionRowSelector);
          launcherAbsentBeforeWatch = !document.getElementById("timestamp-player-launcher");
          playerAbsentBeforeWatch = !document.getElementById("timestamp-player-root");
          routeEnteredAt = performance.now();
          history.pushState({}, "", ${JSON.stringify(watchPath)});
          document.dispatchEvent(new CustomEvent("yt-navigate-finish", { bubbles: true }));
          window.dispatchEvent(new CustomEvent("yt-navigate-finish"));
          reportSuccessWhenReady();
          setTimeout(() => {
            restoreDescription();
            descriptionHydrationElapsedMs = performance.now() - routeEnteredAt;
            reportSuccessWhenReady();
          }, ${DESCRIPTION_HYDRATION_DELAY_MS});
          setTimeout(() => {
            restoreActions();
            actionHydrationElapsedMs = performance.now() - routeEnteredAt;
            reportSuccessWhenReady();
          }, ${ACTION_HYDRATION_DELAY_MS});
          setTimeout(reportFailure, 12_000);
        }, 500);
      });
    </script>
  </body>
</html>`;
}

export function createScenarioMarkup(scenario) {
  const videoIdAttribute = escapeHtml(scenario.videoId);
  const timestampMarkup = createTimestampMarkup(scenario.videoId);
  if (scenario.kind === "watch") {
    return `
      <ytd-page-manager data-smoke-kind="watch">
        <ytd-watch-flexy video-id="${videoIdAttribute}">
          <div id="movie_player" class="html5-video-player">
            <video class="html5-main-video" preload="auto" src="${SMOKE_MEDIA_PATH}"></video>
          </div>
          <ytd-watch-metadata>
            <div id="description-inline-expander" expanded>
              <div id="expanded">${timestampMarkup}</div>
            </div>
            <div id="above-the-fold">
              <div id="actions">
                <div id="top-level-buttons-computed">
                  <ytd-button-renderer id="share-button"><button type="button">Localized action</button></ytd-button-renderer>
                </div>
              </div>
            </div>
          </ytd-watch-metadata>
        </ytd-watch-flexy>
      </ytd-page-manager>`;
  }
  if (scenario.kind === "music") {
    return `
      <ytmusic-app-layout data-smoke-kind="music">
        <ytmusic-player-page id="player-page" video-id="${videoIdAttribute}" data-video-id="${videoIdAttribute}">
          <ytmusic-player>
            <div id="movie_player" class="html5-video-player">
              <video class="html5-main-video" preload="auto" src="${SMOKE_MEDIA_PATH}"></video>
            </div>
          </ytmusic-player>
          <ytmusic-description-shelf-renderer expanded>
            <div id="description">${timestampMarkup}</div>
          </ytmusic-description-shelf-renderer>
          <div id="actions">
            <ytmusic-button-renderer id="share-button"><button type="button">Localized music action</button></ytmusic-button-renderer>
          </div>
        </ytmusic-player-page>
      </ytmusic-app-layout>`;
  }
  throw new TypeError(`Unsupported Chrome smoke scenario kind: ${scenario.kind}`);
}

export function validateSmokeResult(result, scenario) {
  let resultUrl = null;
  try {
    resultUrl = new URL(result?.href);
  } catch (_error) {
    // The shared validation failure below reports the malformed result.
  }
  if (
    result?.startedOffWatch !== true
    || !Number.isFinite(result?.descriptionHydrationElapsedMs)
    || result.descriptionHydrationElapsedMs < MIN_DESCRIPTION_HYDRATION_ELAPSED_MS
    || !Number.isFinite(result?.actionHydrationElapsedMs)
    || result.actionHydrationElapsedMs < MIN_ACTION_HYDRATION_ELAPSED_MS
    || result?.launcherAbsentBeforeWatch !== true
    || result?.launcherOwnedByActionRow !== true
    || result?.playerAbsentBeforeWatch !== true
    || result?.kind !== scenario.kind
    || result?.hostname !== scenario.hostname
    || result?.hasActionRow !== true
    || result?.hasDescription !== true
    || result?.hasExpectedShell !== true
    || result?.videoOwnedByExpectedShell !== true
    || resultUrl?.protocol !== "https:"
    || resultUrl?.hostname !== scenario.hostname
    || resultUrl?.pathname !== "/watch"
    || resultUrl?.searchParams.get("v") !== scenario.videoId
    || result?.trackCount !== EXPECTED_TRACKS.length
    || JSON.stringify(result?.trackTimes) !== JSON.stringify(
      EXPECTED_TRACKS.map(({ time }) => time)
    )
    || JSON.stringify(result?.trackTitles) !== JSON.stringify(
      EXPECTED_TRACKS.map(({ title }) => title)
    )
    || typeof result.launcherText !== "string"
    || !result.launcherText.includes("Tracklist")
  ) {
    throw new Error(
      `${formatScenarioName(scenario)} result did not prove the expected cold non-watch to watch transition`
    );
  }
}

export function formatScenarioName(scenario) {
  return scenario.kind === "music" ? "YouTube Music" : "YouTube Watch";
}

function createTimestampMarkup(videoId) {
  const encodedVideoId = encodeURIComponent(videoId);
  return EXPECTED_TRACKS.map(({ time, title }, index) => {
    return `<a href="/watch?v=${encodedVideoId}&amp;t=${index}s">${time}</a> ${title}`;
  }).join("<br>");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
