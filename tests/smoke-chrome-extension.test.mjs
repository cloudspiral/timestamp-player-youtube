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
  createCertificateArgs,
  getRequestHostname,
} from "../scripts/chrome-smoke-fixture-server.mjs";

test("Chrome smoke scenarios cover distinct Watch and Music cold-route structures", () => {
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
  assert.match(createScenarioMarkup(SMOKE_SCENARIOS[1]), /<ytmusic-player-page/);
  assert.match(createScenarioMarkup(SMOKE_SCENARIOS[1]), /<ytmusic-app-layout/);
  assert.match(createScenarioMarkup(SMOKE_SCENARIOS[1]), /<ytmusic-description-shelf-renderer/);
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
        clearsVideoBeforeScroll: true,
        compactToggleHeight: 24,
        compactToggleWidth: 24,
        height: 43,
        inlineCompact: true,
        playerTopBeforeScroll: 375,
        position: "absolute",
        resizeGutterOpacity: 0,
        rootIdentityPreserved: true,
        rootParentIsDocumentElement: true,
        scrollY: 360,
        seekHitHeight: 24,
        titleOpacity: 1,
        videoBottomBeforeScroll: 360,
        width: 395,
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
      withCompactLayout({ resizeGutterOpacity: 0.1 }),
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
