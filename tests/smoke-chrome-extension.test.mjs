import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import {
  SMOKE_HOSTNAMES,
  SMOKE_SCENARIOS,
  createFixtureHtml,
  createScenarioMarkup,
  validateSmokeResult,
} from "../scripts/chrome-smoke-scenarios.mjs";
import { createBrowserRunnerArgs } from "../scripts/chrome-smoke-browser.mjs";
import {
  SMOKE_EXTENSION_READY_PATH,
  createCertificateArgs,
  getRequestHostname,
} from "../scripts/chrome-smoke-fixture-server.mjs";

test("Chrome smoke scenarios cover distinct Watch and Music cold-route structures", () => {
  assert.equal(SMOKE_EXTENSION_READY_PATH, "/__timestamp_player_extension_ready");
  assert.deepEqual(
    SMOKE_SCENARIOS.map(({ hostname, kind }) => ({ hostname, kind })),
    [
      { hostname: "www.youtube.com", kind: "watch" },
      { hostname: "music.youtube.com", kind: "music" },
    ]
  );
  assert.deepEqual(SMOKE_HOSTNAMES, ["www.youtube.com", "music.youtube.com"]);

  for (const scenario of SMOKE_SCENARIOS) {
    const markup = createScenarioMarkup(scenario);
    const html = createFixtureHtml(scenario);

    assert.match(markup, new RegExp(`video-id=["']${scenario.videoId}["']`));
    assert.match(markup, /<video class="html5-main-video"/);
    assert.match(markup, /id="smoke-video-title"/);
    assert.match(markup, /0:00/);
    assert.match(markup, /0:01/);
    assert.match(markup, /0:02/);
    assert.match(html, /data-started-off-watch="true"/);
    assert.match(html, /launcherAbsentBeforeWatch = !document\.getElementById/);
    assert.match(html, /playerAbsentBeforeWatch = !document\.getElementById/);
    assert.match(html, /stageElement\(smokeScenario\.descriptionSelector\)/);
    assert.match(html, /stageElement\(smokeScenario\.actionRowSelector\)/);
    assert.match(html, /launcher\.click\(\)/);
    assert.match(html, /compactButton\.click\(\)/);
    assert.match(html, /getComputedStyle\(resizeHandle, "::before"\)/);
    assert.match(html, /new PointerEvent\("pointermove"/);
    assert.match(html, /new MouseEvent\("dblclick"/);
    assert.match(html, /resizeKeysUnconsumed/);
    assert.match(html, /automaticTitleGap/);
    assert.match(html, /extremeTitleOverlap/);
    assert.match(html, /stickyCollisionWidthAfterScroll/);
    assert.match(html, /root\.parentElement === document\.documentElement/);
    assert.match(html, /window\.scrollTo\(0, 360\)/);
    assert.match(html, /}, 2800\);/);
    assert.match(html, /}, 4200\);/);
    assert.match(html, new RegExp(`"hostname":\\s*"${escapeRegExp(scenario.hostname)}"`));
    assert.match(html, new RegExp(`/watch\\?v=${scenario.videoId}`));
    const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(inlineScript);
    assert.doesNotThrow(() => new vm.Script(inlineScript));
  }

  assert.match(createScenarioMarkup(SMOKE_SCENARIOS[0]), /<ytd-watch-flexy/);
  assert.match(createScenarioMarkup(SMOKE_SCENARIOS[0]), /id="top-level-buttons-computed"/);
  assert.match(
    createScenarioMarkup(SMOKE_SCENARIOS[0]),
    /id="title" class="smoke-video-title-container"[\s\S]*?<h1><yt-formatted-string/
  );
  assert.match(createScenarioMarkup(SMOKE_SCENARIOS[1]), /<ytmusic-player-page/);
  assert.match(createScenarioMarkup(SMOKE_SCENARIOS[1]), /<ytmusic-app-layout/);
  assert.match(createScenarioMarkup(SMOKE_SCENARIOS[1]), /<ytmusic-description-shelf-renderer/);
  assert.match(
    createScenarioMarkup(SMOKE_SCENARIOS[1]),
    /id="header" class="smoke-video-title-container"[\s\S]*?class="title"/
  );
  assert.throws(
    () => createScenarioMarkup({ kind: "unsupported", videoId: "fixture" }),
    /Unsupported Chrome smoke scenario kind/
  );
});

test("smoke result validation binds every proof to its exact scenario", () => {
  for (const scenario of SMOKE_SCENARIOS) {
    const validResult = {
      compactLayout: {
        actionGapAfterScroll: 6,
        actionGapBeforeScroll: 6,
        actionRightOffsetAfterScroll: 0,
        actionRightOffsetBeforeScroll: 0,
        anchorTopAfterScroll: 120,
        anchorTopBeforeScroll: 424,
        automaticTitleGap: 12,
        automaticWidth: 335,
        clearsVideoBeforeScroll: true,
        compactToggleHeight: 24,
        compactToggleWidth: 24,
        extremeTitleOverlap: 390,
        extremeWidth: 300,
        fitConstrainedWidth: 335,
        fitExpandedWidth: 512,
        fitRestoredCollisionWidth: 335,
        fitShrunkWidth: 300,
        height: 43,
        inlineCompact: true,
        manualTitleOverlap: 48,
        manualWidth: 395,
        playerTopBeforeScroll: 375,
        pointerResizeAvoidedFocus: true,
        position: "absolute",
        resizeHandleAriaHidden: "true",
        resizeHandleTabIndex: -1,
        resizeGutterDisplay: "none",
        resizeKeysPreservedWidth: true,
        resizeKeysUnconsumed: true,
        rootIdentityPreserved: true,
        rootParentIsDocumentElement: true,
        scrollY: 360,
        seekHitHeight: 24,
        stickyCollisionWidthAfterScroll: 335,
        stickyCollisionWidthBeforeScroll: 335,
        titleOpacity: 1,
        videoBottomBeforeScroll: 360,
        width: 335,
      },
      hasActionRow: true,
      hasDescription: true,
      hasExpectedShell: true,
      hostname: scenario.hostname,
      href: `https://${scenario.hostname}:4443/watch?v=${scenario.videoId}`,
      kind: scenario.kind,
      actionHydrationElapsedMs: 4_200,
      descriptionHydrationElapsedMs: 2_800,
      launcherText: "Tracklist",
      launcherAbsentBeforeWatch: true,
      launcherOwnedByActionRow: true,
      playerAbsentBeforeWatch: true,
      startedOffWatch: true,
      trackCount: 3,
      trackTimes: ["0:00", "0:01", "0:02"],
      trackTitles: ["Opening", "Middle", "Finale"],
      videoOwnedByExpectedShell: true,
    };
    assert.doesNotThrow(() => validateSmokeResult(validResult, scenario));

    const otherHostname = scenario.hostname === "www.youtube.com"
      ? "music.youtube.com"
      : "www.youtube.com";
    const withCompactLayout = (changes) => ({
      ...validResult,
      compactLayout: {
        ...validResult.compactLayout,
        ...changes,
      },
    });
    for (const invalidResult of [
      { ...validResult, hostname: otherHostname },
      { ...validResult, actionHydrationElapsedMs: 3_999 },
      { ...validResult, descriptionHydrationElapsedMs: 2_499 },
      { ...validResult, href: `https://${scenario.hostname}:4443/results?v=${scenario.videoId}` },
      { ...validResult, href: `https://${scenario.hostname}:4443/watch?v=wrong-video` },
      { ...validResult, kind: scenario.kind === "music" ? "watch" : "music" },
      { ...validResult, hasActionRow: false },
      { ...validResult, hasDescription: false },
      { ...validResult, hasExpectedShell: false },
      { ...validResult, launcherText: "" },
      { ...validResult, launcherAbsentBeforeWatch: false },
      { ...validResult, launcherOwnedByActionRow: false },
      { ...validResult, playerAbsentBeforeWatch: false },
      { ...validResult, startedOffWatch: false },
      { ...validResult, trackCount: 2 },
      { ...validResult, trackTimes: ["0:00", "0:01", "0:03"] },
      { ...validResult, trackTitles: ["Opening", "Middle", "Wrong"] },
      { ...validResult, videoOwnedByExpectedShell: false },
      { ...validResult, compactLayout: null },
      withCompactLayout({ inlineCompact: false }),
      withCompactLayout({ position: "fixed" }),
      withCompactLayout({ rootParentIsDocumentElement: false }),
      withCompactLayout({ rootIdentityPreserved: false }),
      withCompactLayout({ height: 29 }),
      withCompactLayout({ height: 45 }),
      withCompactLayout({ width: 397 }),
      withCompactLayout({ width: 299 }),
      withCompactLayout({ automaticWidth: 300 }),
      withCompactLayout({ automaticTitleGap: 14 }),
      withCompactLayout({ extremeWidth: 302 }),
      withCompactLayout({ extremeTitleOverlap: 0 }),
      withCompactLayout({ manualWidth: 390 }),
      withCompactLayout({ manualTitleOverlap: 0 }),
      withCompactLayout({ fitConstrainedWidth: 340 }),
      withCompactLayout({ fitExpandedWidth: 400 }),
      withCompactLayout({ fitRestoredCollisionWidth: 340 }),
      withCompactLayout({ fitShrunkWidth: 335 }),
      withCompactLayout({ stickyCollisionWidthBeforeScroll: 340 }),
      withCompactLayout({ stickyCollisionWidthAfterScroll: 340 }),
      withCompactLayout({ pointerResizeAvoidedFocus: false }),
      withCompactLayout({ resizeHandleAriaHidden: null }),
      withCompactLayout({ resizeHandleTabIndex: 0 }),
      withCompactLayout({ resizeKeysPreservedWidth: false }),
      withCompactLayout({ resizeKeysUnconsumed: false }),
      withCompactLayout({ actionGapBeforeScroll: 4 }),
      withCompactLayout({ actionGapAfterScroll: 8 }),
      withCompactLayout({ actionRightOffsetBeforeScroll: 2 }),
      withCompactLayout({ actionRightOffsetAfterScroll: -2 }),
      withCompactLayout({ anchorTopBeforeScroll: 120 }),
      withCompactLayout({ anchorTopAfterScroll: 122 }),
      withCompactLayout({ scrollY: 0 }),
      withCompactLayout({ clearsVideoBeforeScroll: false }),
      withCompactLayout({ playerTopBeforeScroll: 359 }),
      withCompactLayout({ compactToggleHeight: 23 }),
      withCompactLayout({ compactToggleWidth: 23 }),
      withCompactLayout({ seekHitHeight: 23 }),
      withCompactLayout({ resizeGutterDisplay: "block" }),
      withCompactLayout({ titleOpacity: 0.45 }),
    ]) {
      assert.throws(
        () => validateSmokeResult(invalidResult, scenario),
        /did not prove the expected cold non-watch to watch transition/
      );
    }
  }
});

test("browser runner maps every declared smoke origin to the isolated fixture", () => {
  const args = createBrowserRunnerArgs("/browser/chrome", "https://www.youtube.com:4443/", {
    hostnames: SMOKE_HOSTNAMES,
  });

  assert.ok(args.includes("--chromium-binary=/browser/chrome"));
  assert.ok(args.includes("--start-url=https://www.youtube.com:4443/"));
  assert.ok(args.includes(
    "--args=--host-resolver-rules=MAP www.youtube.com 127.0.0.1,MAP music.youtube.com 127.0.0.1,EXCLUDE localhost"
  ));
});

test("local certificate covers every declared smoke origin", () => {
  const args = createCertificateArgs({
    certificatePath: "/tmp/certificate.pem",
    hostnames: SMOKE_HOSTNAMES,
    privateKeyPath: "/tmp/private-key.pem",
  });

  assert.ok(args.includes("/CN=www.youtube.com"));
  assert.ok(args.includes("subjectAltName=DNS:www.youtube.com,DNS:music.youtube.com"));
  assert.throws(
    () => createCertificateArgs({
      certificatePath: "/tmp/certificate.pem",
      hostnames: [],
      privateKeyPath: "/tmp/private-key.pem",
    }),
    /At least one Chrome smoke hostname is required/
  );
});

test("fixture Host validation ignores ports and rejects malformed values", () => {
  assert.equal(
    getRequestHostname({ headers: { host: "music.youtube.com:44321" } }),
    "music.youtube.com"
  );
  assert.equal(getRequestHostname({ headers: { host: "www.youtube.com" } }), "www.youtube.com");
  for (const malformedHost of [
    "bad host value",
    "evil.example@music.youtube.com",
    "music.youtube.com/path",
    "music.youtube.com:99999",
  ]) {
    assert.equal(getRequestHostname({ headers: { host: malformedHost } }), "");
  }
  assert.equal(getRequestHostname({ headers: {} }), "");
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
