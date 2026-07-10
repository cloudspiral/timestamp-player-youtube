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
```

- `npm test` uses Node's native discovery to run every `*.test.mjs` file.
- `npm run check` adds JavaScript syntax and manifest validation.
- `npm run lint:firefox` prepares both package trees and validates the Firefox
  package with `web-ext`.
- `npm run verify:packages` proves the generated manifests, referenced assets,
  runtime file coverage, and copied bytes match the source tree.
- `npm run smoke:chrome` loads the generated Chrome extension and exercises a
  cold non-watch to watch SPA transition without a document reload.

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
The test maps `www.youtube.com` to an ephemeral local HTTPS fixture, starts on a
non-watch page, navigates with `history.pushState`, and passes only if the
packaged extension inserts the Tracklist launcher without a reload.

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
outcomes, and launcher attachment. They never include comment or description
text, track titles, author identities, continuation tokens, request URLs,
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

Automated fixtures complement rather than replace the real-world catalog in
`TEST_VIDEOS.md`. Before a release, exercise at least:

- Home or Search to the first timestamped video without a reload.
- Watch A to Watch B, and Watch to Home to Watch.
- Description, visible-comment, fetched-comment, and native-moment sources.
- Anchored, compact, floating, fullscreen, shuffle, and repeat behavior.
- A long tracklist and keyboard focus while the active track changes.

Generated Chrome and Firefox packages are verified byte-for-byte, Firefox is
linted with `web-ext`, and the Chrome package is loaded by the automated cold-SPA
smoke. Continue using the real-world catalog above for YouTube layout and media
behavior that a synthetic fixture cannot represent.
