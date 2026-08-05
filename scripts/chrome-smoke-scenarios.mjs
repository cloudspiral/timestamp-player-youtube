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
const COMPACT_PLAYER_MIN_HEIGHT_PX = 30;
const COMPACT_PLAYER_MAX_HEIGHT_PX = 44;
const COMPACT_PLAYER_MIN_WIDTH_PX = 300;
const COMPACT_PLAYER_MAX_WIDTH_PX = 396;
const COMPACT_PLAYER_MAX_FITTED_WIDTH_PX = 512;
const COMPACT_ANCHOR_GAP_PX = 6;
const COMPACT_TITLE_GAP_PX = 12;
const COMPACT_LAYOUT_TOLERANCE_PX = 1.5;
const COMPACT_TITLE_MIN_OPACITY = 0.99;
const COMPACT_CONTROL_MIN_SIZE_PX = 24;
const COMPACT_CONTROL_MAX_SIZE_PX = 48;
const STICKY_ANCHOR_TOP_PX = 120;
const STICKY_SCROLL_Y_PX = 360;
const COMPACT_POINTER_GROWTH_PX = 60;
const EXTREME_VIDEO_TITLE = "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const MODERATE_VIDEO_TITLE = "Moderate title 123";
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
      html, body { margin: 0; min-height: 1800px; }
      body, ytd-page-manager, ytd-watch-flexy, ytd-watch-metadata,
      ytmusic-app-layout, ytmusic-player-page, ytmusic-player,
      ytmusic-description-shelf-renderer, #description-inline-expander,
      #description, #expanded, #actions,
      #top-level-buttons-computed { display: block; min-width: 320px; min-height: 32px; }
      ytd-watch-metadata, ytmusic-player-page { min-height: 1200px; }
      #above-the-fold { position: relative; min-height: 800px; }
      ytmusic-player-page { position: relative; }
      ytmusic-description-shelf-renderer,
      #description-inline-expander { min-height: 64px; }
      #movie_player, video { display: block; width: 640px; height: 360px; }
      #actions {
        position: sticky;
        top: ${STICKY_ANCHOR_TOP_PX}px;
        width: 520px;
        height: 40px;
      }
      #top-level-buttons-computed { width: 520px; height: 40px; }
      .smoke-video-title-container {
        position: absolute;
        left: 0;
        z-index: 1;
        height: 20px;
        margin: 0;
        color: #111;
      }
      #above-the-fold > .smoke-video-title-container { top: -48px; }
      ytmusic-player-page > .smoke-video-title-container { top: 376px; }
      .smoke-video-title-container h1,
      .smoke-video-title-container .title { margin: 0; font: inherit; }
      #smoke-video-title {
        display: inline-block;
        font: 16px/20px monospace;
        white-space: nowrap;
      }
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
      let compactLayoutProof = null;
      let compactProbeError = "";
      let compactProbeStarted = false;
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

        if (!compactLayoutProof) {
          if (!compactProbeStarted) {
            compactProbeStarted = true;
            collectCompactLayoutProof({ actionRow, launcher, root, video })
              .then((proof) => {
                compactLayoutProof = proof;
                reportSuccessWhenReady();
              })
              .catch((error) => {
                compactProbeError = error?.message || String(error);
                reportFailure();
              });
          }
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
            compactLayout: compactLayoutProof,
            trackCount: trackRows.length,
            trackTimes,
            trackTitles,
            videoOwnedByExpectedShell: Boolean(video.closest(smokeScenario.shellSelector))
          })
        });
      }

      async function collectCompactLayoutProof({ actionRow, launcher, root, video }) {
        if (!root.classList.contains("is-visible")) {
          launcher.click();
          await waitForAnimationFrames(2);
        }

        const compactButton = root.querySelector(".ts-compact-toggle");
        if (!compactButton) {
          throw new Error("Compact layout probe could not find the compact toggle");
        }
        if (!root.classList.contains("is-inline-compact")) {
          compactButton.click();
          await waitForAnimationFrames(2);
        }

        const actionAnchor = actionRow.closest("#actions") || actionRow;
        const playPauseButton = root.querySelector(".ts-play-pause");
        const progressSlider = root.querySelector(".ts-progress-slider");
        const resizeHandle = root.querySelector(".ts-resize-handle");
        const trackTitle = root.querySelector(".ts-track");
        const videoTitle = document.getElementById("smoke-video-title");
        if (
          !actionAnchor
          || !playPauseButton
          || !progressSlider
          || !resizeHandle
          || !trackTitle
          || !videoTitle
        ) {
          throw new Error("Compact layout probe could not find its anchor, titles, or compact controls");
        }

        const originalRoot = root;
        const extreme = readCompactLayout(root, actionAnchor);
        const extremeTitleRect = readRenderedBottomLine(videoTitle);
        if (!extremeTitleRect) {
          throw new Error("Compact layout probe could not measure the extreme video title");
        }
        const compactButtonRect = compactButton.getBoundingClientRect();
        const progressSliderRect = progressSlider.getBoundingClientRect();
        const videoRect = video.getBoundingClientRect();
        const resizeGutterStyle = getComputedStyle(resizeHandle, "::before");
        const widthBeforeResizeKeys = roundMetric(root.getBoundingClientRect().width);
        const resizeKeysUnconsumed = [
          "Enter",
          " ",
          "Home",
          "End",
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown"
        ].every((key) => {
          const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key });
          resizeHandle.dispatchEvent(event);
          return !event.defaultPrevented;
        });
        const resizeKeysPreservedWidth = widthBeforeResizeKeys
          === roundMetric(root.getBoundingClientRect().width);
        const compactControlMouseDown = new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          cancelable: true
        });
        const compactControlMouseFocusPrevented = !playPauseButton.dispatchEvent(
          compactControlMouseDown
        );
        progressSlider.focus({ preventScroll: true });
        const compactSeekFocusedBeforePointerEnd = document.activeElement === progressSlider;
        progressSlider.dispatchEvent(new PointerEvent("pointerup", {
          bubbles: true,
          button: 0,
          buttons: 0,
          pointerId: 16,
          pointerType: "mouse"
        }));
        const compactSeekPointerFocusReleased = compactSeekFocusedBeforePointerEnd
          && document.activeElement !== progressSlider;

        videoTitle.textContent = ${JSON.stringify(MODERATE_VIDEO_TITLE)};
        await waitForAnimationFrames(3);
        const before = readCompactLayout(root, actionAnchor);
        const automaticTitleRect = readRenderedBottomLine(videoTitle);
        if (!automaticTitleRect) {
          throw new Error("Compact layout probe could not measure the moderate video title");
        }

        const pointerStartX = resizeHandle.getBoundingClientRect().left + 2;
        resizeHandle.dispatchEvent(new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: pointerStartX,
          pointerId: 17,
          pointerType: "mouse"
        }));
        resizeHandle.dispatchEvent(new PointerEvent("pointermove", {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: pointerStartX - ${COMPACT_POINTER_GROWTH_PX},
          pointerId: 17,
          pointerType: "mouse"
        }));
        resizeHandle.dispatchEvent(new PointerEvent("pointerup", {
          bubbles: true,
          button: 0,
          buttons: 0,
          clientX: pointerStartX - ${COMPACT_POINTER_GROWTH_PX},
          pointerId: 17,
          pointerType: "mouse"
        }));
        await waitForAnimationFrames(3);
        const manual = readCompactLayout(root, actionAnchor);
        const pointerResizeAvoidedFocus = document.activeElement !== resizeHandle;

        const longTrackTitle = "An intentionally enormous smoke track title that must fit much wider than the compact default";
        trackTitle.textContent = longTrackTitle;
        trackTitle.title = longTrackTitle;
        resizeHandle.dispatchEvent(new MouseEvent("dblclick", {
          bubbles: true,
          button: 0,
          cancelable: true,
          clientX: resizeHandle.getBoundingClientRect().left + 2
        }));
        await waitForAnimationFrames(3);
        const constrainedFit = readCompactLayout(root, actionAnchor);

        videoTitle.textContent = "";
        await waitForAnimationFrames(3);
        const expandedFit = readCompactLayout(root, actionAnchor);

        videoTitle.textContent = ${JSON.stringify(MODERATE_VIDEO_TITLE)};
        await waitForAnimationFrames(3);
        const restoredCollision = readCompactLayout(root, actionAnchor);

        window.scrollTo(0, ${STICKY_SCROLL_Y_PX});
        await waitForAnimationFrames(3);

        const after = readCompactLayout(root, actionAnchor);

        trackTitle.textContent = "Short";
        trackTitle.title = "Short";
        resizeHandle.dispatchEvent(new MouseEvent("dblclick", {
          bubbles: true,
          button: 0,
          cancelable: true,
          clientX: resizeHandle.getBoundingClientRect().left + 2
        }));
        await waitForAnimationFrames(3);
        const shrunkFit = readCompactLayout(root, actionAnchor);
        return {
          actionGapAfterScroll: after.actionGap,
          actionGapBeforeScroll: before.actionGap,
          actionRightOffsetAfterScroll: after.actionRightOffset,
          actionRightOffsetBeforeScroll: before.actionRightOffset,
          anchorTopAfterScroll: after.anchorTop,
          anchorTopBeforeScroll: before.anchorTop,
          automaticTitleGap: roundMetric(before.playerLeft - automaticTitleRect.right),
          automaticWidth: before.playerWidth,
          clearsVideoBeforeScroll: before.playerTop >= roundMetric(videoRect.bottom),
          compactControlMouseFocusPrevented,
          compactSeekPointerFocusReleased,
          compactToggleHeight: roundMetric(compactButtonRect.height),
          compactToggleWidth: roundMetric(compactButtonRect.width),
          extremeTitleOverlap: roundMetric(extremeTitleRect.right - extreme.playerLeft),
          extremeWidth: extreme.playerWidth,
          fitConstrainedWidth: constrainedFit.playerWidth,
          fitExpandedWidth: expandedFit.playerWidth,
          fitRestoredCollisionWidth: restoredCollision.playerWidth,
          fitShrunkWidth: shrunkFit.playerWidth,
          height: before.playerHeight,
          inlineCompact: root.classList.contains("is-inline-compact"),
          manualTitleOverlap: roundMetric(automaticTitleRect.right - manual.playerLeft),
          manualWidth: manual.playerWidth,
          playerTopBeforeScroll: before.playerTop,
          pointerResizeAvoidedFocus,
          position: getComputedStyle(root).position,
          resizeHandleAriaHidden: resizeHandle.getAttribute("aria-hidden"),
          resizeHandleTabIndex: resizeHandle.tabIndex,
          resizeGutterDisplay: resizeGutterStyle.display,
          resizeKeysPreservedWidth,
          resizeKeysUnconsumed,
          rootIdentityPreserved: originalRoot === document.getElementById("timestamp-player-root"),
          rootParentIsDocumentElement: root.parentElement === document.documentElement,
          scrollY: roundMetric(window.scrollY),
          seekHitHeight: roundMetric(progressSliderRect.height),
          stickyCollisionWidthAfterScroll: after.playerWidth,
          stickyCollisionWidthBeforeScroll: restoredCollision.playerWidth,
          titleOpacity: Number.parseFloat(getComputedStyle(trackTitle).opacity),
          videoBottomBeforeScroll: roundMetric(videoRect.bottom),
          width: before.playerWidth
        };
      }

      function readCompactLayout(root, actionAnchor) {
        const playerRect = root.getBoundingClientRect();
        const anchorRect = actionAnchor.getBoundingClientRect();
        return {
          actionGap: roundMetric(anchorRect.top - playerRect.bottom),
          actionRightOffset: roundMetric(anchorRect.right - playerRect.right),
          anchorTop: roundMetric(anchorRect.top),
          playerHeight: roundMetric(playerRect.height),
          playerLeft: roundMetric(playerRect.left),
          playerTop: roundMetric(playerRect.top),
          playerWidth: roundMetric(playerRect.width)
        };
      }

      function readRenderedBottomLine(element) {
        const range = document.createRange();
        try {
          range.selectNodeContents(element);
          const rects = [...range.getClientRects()].filter((rect) => {
            return rect.width > 0 && rect.height > 0;
          });
          if (!rects.length) {
            return null;
          }
          const rect = rects.reduce((bottomMost, candidate) => {
            if (
              candidate.bottom > bottomMost.bottom
              || (candidate.bottom === bottomMost.bottom && candidate.right > bottomMost.right)
            ) {
              return candidate;
            }
            return bottomMost;
          });
          return {
            bottom: roundMetric(rect.bottom),
            left: roundMetric(rect.left),
            right: roundMetric(rect.right),
            top: roundMetric(rect.top)
          };
        } finally {
          range.detach?.();
        }
      }

      function roundMetric(value) {
        return Math.round(value * 100) / 100;
      }

      function waitForAnimationFrames(count) {
        return new Promise((resolve) => {
          const wait = () => {
            if (count <= 0) {
              resolve();
              return;
            }
            count -= 1;
            requestAnimationFrame(wait);
          };
          wait();
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
            compactLayout: compactLayoutProof,
            compactProbeError,
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
              <div id="title" class="smoke-video-title-container">
                <h1><yt-formatted-string id="smoke-video-title">${EXTREME_VIDEO_TITLE}</yt-formatted-string></h1>
              </div>
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
          <div id="header" class="smoke-video-title-container">
            <div class="title"><yt-formatted-string id="smoke-video-title">${EXTREME_VIDEO_TITLE}</yt-formatted-string></div>
          </div>
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
  const compactLayout = result?.compactLayout;
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
    || compactLayout?.inlineCompact !== true
    || compactLayout?.position !== "absolute"
    || compactLayout?.rootParentIsDocumentElement !== true
    || compactLayout?.rootIdentityPreserved !== true
    || !isFiniteBetween(
      compactLayout?.height,
      COMPACT_PLAYER_MIN_HEIGHT_PX,
      COMPACT_PLAYER_MAX_HEIGHT_PX
    )
    || !isFiniteBetween(
      compactLayout?.width,
      COMPACT_PLAYER_MIN_WIDTH_PX,
      COMPACT_PLAYER_MAX_WIDTH_PX
    )
    || !isFiniteBetween(
      compactLayout?.automaticWidth,
      COMPACT_PLAYER_MIN_WIDTH_PX + 10,
      COMPACT_PLAYER_MAX_WIDTH_PX - 10
    )
    || !isWithinTolerance(
      compactLayout?.automaticTitleGap,
      COMPACT_TITLE_GAP_PX,
      COMPACT_LAYOUT_TOLERANCE_PX
    )
    || !isWithinTolerance(
      compactLayout?.extremeWidth,
      COMPACT_PLAYER_MIN_WIDTH_PX,
      COMPACT_LAYOUT_TOLERANCE_PX
    )
    || !Number.isFinite(compactLayout?.extremeTitleOverlap)
    || compactLayout.extremeTitleOverlap <= 0
    || !isWithinTolerance(
      compactLayout?.manualWidth - compactLayout?.automaticWidth,
      COMPACT_POINTER_GROWTH_PX,
      COMPACT_LAYOUT_TOLERANCE_PX
    )
    || !Number.isFinite(compactLayout?.manualTitleOverlap)
    || compactLayout.manualTitleOverlap <= 0
    || !isWithinTolerance(
      compactLayout?.fitConstrainedWidth,
      compactLayout?.automaticWidth,
      COMPACT_LAYOUT_TOLERANCE_PX
    )
    || !isFiniteBetween(
      compactLayout?.fitExpandedWidth,
      COMPACT_PLAYER_MAX_WIDTH_PX + 40,
      COMPACT_PLAYER_MAX_FITTED_WIDTH_PX
    )
    || !isWithinTolerance(
      compactLayout?.fitRestoredCollisionWidth,
      compactLayout?.automaticWidth,
      COMPACT_LAYOUT_TOLERANCE_PX
    )
    || !isFiniteBetween(
      compactLayout?.fitShrunkWidth,
      COMPACT_PLAYER_MIN_WIDTH_PX,
      compactLayout?.automaticWidth - 10
    )
    || !isWithinTolerance(
      compactLayout?.stickyCollisionWidthBeforeScroll,
      compactLayout?.automaticWidth,
      COMPACT_LAYOUT_TOLERANCE_PX
    )
    || !isWithinTolerance(
      compactLayout?.stickyCollisionWidthAfterScroll,
      compactLayout?.automaticWidth,
      COMPACT_LAYOUT_TOLERANCE_PX
    )
    || compactLayout?.pointerResizeAvoidedFocus !== true
    || compactLayout?.compactControlMouseFocusPrevented !== true
    || compactLayout?.compactSeekPointerFocusReleased !== true
    || compactLayout?.resizeHandleAriaHidden !== "true"
    || compactLayout?.resizeHandleTabIndex !== -1
    || compactLayout?.resizeKeysPreservedWidth !== true
    || compactLayout?.resizeKeysUnconsumed !== true
    || !isWithinTolerance(
      compactLayout?.actionGapBeforeScroll,
      COMPACT_ANCHOR_GAP_PX,
      COMPACT_LAYOUT_TOLERANCE_PX
    )
    || !isWithinTolerance(
      compactLayout?.actionGapAfterScroll,
      COMPACT_ANCHOR_GAP_PX,
      COMPACT_LAYOUT_TOLERANCE_PX
    )
    || !isWithinTolerance(
      compactLayout?.actionRightOffsetBeforeScroll,
      0,
      COMPACT_LAYOUT_TOLERANCE_PX
    )
    || !isWithinTolerance(
      compactLayout?.actionRightOffsetAfterScroll,
      0,
      COMPACT_LAYOUT_TOLERANCE_PX
    )
    || !Number.isFinite(compactLayout?.anchorTopBeforeScroll)
    || compactLayout.anchorTopBeforeScroll <= STICKY_ANCHOR_TOP_PX
    || !isWithinTolerance(
      compactLayout?.anchorTopAfterScroll,
      STICKY_ANCHOR_TOP_PX,
      COMPACT_LAYOUT_TOLERANCE_PX
    )
    || !isWithinTolerance(
      compactLayout?.scrollY,
      STICKY_SCROLL_Y_PX,
      COMPACT_LAYOUT_TOLERANCE_PX
    )
    || compactLayout?.clearsVideoBeforeScroll !== true
    || !Number.isFinite(compactLayout?.playerTopBeforeScroll)
    || !Number.isFinite(compactLayout?.videoBottomBeforeScroll)
    || compactLayout.playerTopBeforeScroll < compactLayout.videoBottomBeforeScroll
    || !isFiniteBetween(
      compactLayout?.compactToggleHeight,
      COMPACT_CONTROL_MIN_SIZE_PX,
      COMPACT_CONTROL_MAX_SIZE_PX
    )
    || !isFiniteBetween(
      compactLayout?.compactToggleWidth,
      COMPACT_CONTROL_MIN_SIZE_PX,
      COMPACT_CONTROL_MAX_SIZE_PX
    )
    || !isFiniteBetween(
      compactLayout?.seekHitHeight,
      COMPACT_CONTROL_MIN_SIZE_PX,
      COMPACT_CONTROL_MAX_SIZE_PX
    )
    || compactLayout?.resizeGutterDisplay !== "none"
    || !isFiniteBetween(compactLayout?.titleOpacity, COMPACT_TITLE_MIN_OPACITY, 1)
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
      [
        `${formatScenarioName(scenario)} result did not prove the expected cold non-watch to watch transition and compact layout contract.`,
        `Compact layout: ${JSON.stringify(compactLayout)}`,
      ].join(" ")
    );
  }
}

function isFiniteBetween(value, minimum, maximum) {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isWithinTolerance(value, expected, tolerance) {
  return Number.isFinite(value) && Math.abs(value - expected) <= tolerance;
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
