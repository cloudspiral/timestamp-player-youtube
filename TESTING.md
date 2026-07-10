# Testing Timestamp Player for YouTube

The extension uses Node's built-in `node:test` runner. No test framework or
browser DOM package is required for the fast suite.

## Everyday commands

```sh
npm test
npm run check
npm run lint:firefox
```

- `npm test` uses Node's native discovery to run every `*.test.mjs` file.
- `npm run check` adds JavaScript syntax and manifest validation.
- `npm run lint:firefox` prepares both package trees and validates the Firefox
  package with `web-ext`.

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
5. A packaged-browser smoke test for route injection and real extension loading
   (planned release coverage; not part of the fast suite yet).

The fake DOMs are intentionally local to their test files. They implement only
the methods used by the production helper, which keeps failures readable and
avoids making tests accidentally depend on a full browser implementation.

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

Generated Chrome and Firefox packages are linted/built by the release tooling.
An automated unpacked-browser smoke remains planned; until it lands, use the
manual route and package checks above for real-browser release validation.
