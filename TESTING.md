# Testing Timestamp Player for YouTube

The extension uses Node's built-in `node:test` runner. No test framework or
browser DOM package is required for the fast suite.

## Everyday commands

```sh
npm test
npm run check
npm run verify:packages
npm run lint:firefox
npm run smoke:chrome
npm run test:chapters
```

- `npm test` uses Node's native discovery to run every `*.test.mjs` file.
- `npm run check` adds JavaScript syntax and manifest validation.
- `npm run lint:firefox` prepares both package trees and validates the Firefox
  package with `web-ext`.
- `npm run verify:packages` proves the generated manifests, referenced assets,
  runtime file coverage, and copied bytes match the source tree.
- `npm run smoke:chrome` loads the generated Chrome extension and exercises
  independent standard YouTube Watch and YouTube Music cold-SPA transitions
  without document reloads. Additional chapter scenarios verify direct loading
  and a late structured-data upgrade from a reaction comment, without a visible
  chapter panel or a change in playback position/pause state.
- `npm run test:chapters` covers structured chapter parsing, current-video page
  data, shared requests, timeout/abort/retry behavior, DOM provenance, and late
  discovery. `npm run test:track-selection` covers source priority and title
  preservation.

Every major area also has a targeted script, such as `npm run test:timestamps`,
`npm run test:watch-session`, or `npm run test:settings`. Targeted scripts are
useful while iterating; run the full check before committing.

## How the tests load extension code

Runtime files are classic browser scripts that publish a small namespace on
`globalThis`. Unit tests read those files and execute them in an isolated
`node:vm` context. This keeps production code free of test-only module syntax
and lets each test inject only the browser APIs it needs.

Use the smallest test layer that proves the behavior:

1. Pure functions and reducers for parsing, scoring, source selection, and
   session transitions.
2. Small fake DOM nodes for selector/extraction behavior and stable rendering.
3. JSON fixtures for YouTube response parsing and continuation behavior.
4. Fake clocks and abort signals for retry, timeout, and navigation races.
5. The packaged Chrome smoke for route injection and real extension loading.

The browser smoke is intentionally separate from the fast `npm run check`
suite. It requires Chrome or Chromium and OpenSSL; set `CHROME_BIN` when the
browser executable is outside the standard macOS, Linux, or Windows locations.
The test maps both `www.youtube.com` and `music.youtube.com` to ephemeral local
HTTPS fixtures. Each scenario starts in a fresh browser and follows a
post-registration redirect so Chrome cannot outrun content-script installation.
It then enters the watch route with `history.pushState` and hydrates the
description and action row after separate multi-second delays. It passes only
if the packaged extension
recognizes that origin's synthetic player/description/action markup, renders the
three expected tracks, and inserts the Tracklist launcher in the action row
without a reload. The same run switches into compact mode and verifies real
rendered title geometry, the 300px extreme-title floor, the 12px avoidance gap,
manual pointer overlap, double-click grow and shrink fitting, pointer-only resize
semantics, and sticky anchoring while scrolling.

The fake DOMs are intentionally local to their test files. They implement only
the methods used by the production helper, which keeps failures readable and
avoids making tests accidentally depend on a full browser implementation.

## Opt-in runtime diagnostics

Discovery diagnostics are off by default. To inspect one YouTube tab, run this
in that tab's developer console, then navigate to another video or reload:

```js
sessionStorage.setItem("timestamp-player:debug", "1");
```

Filter the console for `[TimestampPlayer]`. The events report the current video
ID, session generation, media/source decisions, bounded retries, comment-fetch
outcomes, and launcher attachment. Chapter source events additionally report
`chapterKind` and the detection channel (`chapter-markers`, `chapter-panel`, or
`chapter-dom`). They never include comment or description text, track titles,
author identities, continuation tokens, request URLs,
headers, response bodies, or raw errors.

Disable diagnostics for the tab with:

```js
sessionStorage.removeItem("timestamp-player:debug");
```

## Adding a regression

Name files `tests/<area>.test.mjs`; `npm test` discovers them automatically.
Prefer a focused fixture that demonstrates both the failure and the intended
invariant. For SPA bugs, include the navigation generation or current-video
ownership explicitly so a test cannot pass by starting directly on a settled
watch page.

JSON response fixtures belong under `tests/fixtures/<area>/`. Do not include
cookies, API keys, continuation tokens from a real account, comment bodies from
private data, or other captured personal information; use synthetic values.

## Manual release checks

Use [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) to record the complete
automated and manual evidence against the final Chrome and Firefox artifacts.
This section defines the minimum real-browser coverage; the standalone
checklist organizes it without duplicating the test catalog.

Automated fixtures complement rather than replace the real-world catalog in
`TEST_VIDEOS.md`. Before a release, exercise at least:

- Home or Search to the first timestamped video without a reload.
- Watch A to Watch B, and Watch to Home to Watch.
- Description, visible-comment, fetched-comment, and native-moment sources.
- Anchored, compact, floating, fullscreen, shuffle, and repeat behavior.
- A long tracklist and keyboard focus while the active track changes.

Generated Chrome and Firefox packages are verified byte-for-byte, Firefox is
linted with `web-ext`, and the Chrome package is loaded by the automated Watch
and Music cold-SPA smokes. Continue using the real-world catalog above for
YouTube layout and media behavior that synthetic fixtures cannot represent.
