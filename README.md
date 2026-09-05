# Timestamp Player for YouTube

YouTube has lots of videos with timestamps, but it doesn't have playback controls that make full use of them. This extension fixes that.

Timestamp Player makes it easy to navigate tracks, seek within the current track, and even repeat and shuffle tracks in any video that has timestamps.

It reads YouTube chapters, description timestamps, and comment tracklists. It
chooses confirmed creator chapters first, then description timestamps, complete
automatic or unclassified chapters, the best comment tracklist, and finally
sparse YouTube Key Moments. Pinned and uploader comments receive a scoring
advantage among comments; they do not override a complete chapter list.

Chapter discovery reads the player timeline metadata before structured chapter
panels and rendered chapter links. It works without opening YouTube's chapter
panel and refreshes page data when navigating between videos. Unknown chapter
provenance is never treated as creator-authored. Later chapter discoveries can
replace a comment fallback without seeking or interrupting playback.

Open and close the player by clicking the new "Tracklist" button located next to the Share button.

You can also use it in compact bar mode below the video, or pop out into floating panel mode. Drag the compact bar's left edge to resize it, or double-click that edge to fit the current track title. By default, the compact bar temporarily narrows when needed to avoid covering the video title; this can be disabled with “Avoid covering video titles” in the extension options.

Additional settings can be found in extension options.

[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/apdohlkmddbfpmhkoeibajlhpnhilocb)

![Timestamp Player for YouTube compact player](store-assets/screenshots/abbey-road-compact-1280x800.png)

## Running Locally

Install the locked tooling and generate browser-specific package directories:

```sh
npm ci
npm run prepare:packages
```

### Chrome or Brave

1. Clone this repository.
2. Open your browser's extensions URL, e.g. `brave://extensions`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select the generated `dist/chrome` folder.
6. Ensure the extension is enabled. Click Reload on the
extension card after regenerating package sources for any code changes.
7. Refresh the YouTube tab being tested.

### Firefox

1. Clone this repository.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click Load Temporary Add-on.
4. Select `dist/firefox/manifest.json`.
5. Refresh the YouTube tab being tested after loading or reloading the add-on.

## Packaging

Install the locked release tooling:

```sh
npm ci
```

Run checks:

```sh
npm run check
```

Use [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) for the maintainer-facing
clean-checkout-to-artifacts release process and evidence record. See
[`TESTING.md`](TESTING.md) for automated test layers, targeted commands, and
fixture conventions.

Lint the Firefox package:

```sh
npm run lint:firefox
```

Verify that generated package files exactly match their source counterparts and
that every copied runtime file is referenced:

```sh
npm run verify:packages
```

Run the packaged Chrome cold-navigation smoke tests:

```sh
npm run smoke:chrome
```

The smoke runs independent synthetic cold-SPA scenarios for standard YouTube
Watch and YouTube Music, with each description and action row hydrating several
seconds after the player route. It requires Chrome or Chromium plus OpenSSL.
Set `CHROME_BIN` if the browser is not installed in a standard location.

Build Chrome and Firefox upload packages:

```sh
npm run build
```

The final upload zips are written to `web-ext-artifacts/`. Package sources are
generated in `dist/`, which is ignored and can be recreated at any time. Before
uploading, complete the artifact, checksum, and human handoff sections in the
[`release checklist`](RELEASE_CHECKLIST.md).

## Test Videos

See `TEST_VIDEOS.md` for manual test cases.

## Agent and recurring factory automation

GitHub is the durable control plane for this repository. New **Agent task**
issues route to Codex Cloud by default so work can continue while a maintainer's
Mac is offline. The guarded [`WORKFLOW.md`](WORKFLOW.md) remains available for
explicit `symphony-ready` tasks that need the separately managed local Symphony
service.

The recurring factory is visible in GitHub Actions, Issues, Pull requests, and
Security. Dependabot runs weekly, CodeQL runs on pull requests, `master`, and a
staggered weekly schedule, monthly hygiene work is queued on the first Monday,
and quarterly security audits are report-only. Scheduled tasks deduplicate and
remain visibly queued unless the accepted Codex Cloud bot trigger is enabled.

The task lifecycle is intentionally explicit:

1. A maintainer writes acceptance criteria and selects cloud or local routing.
2. The chosen runner implements and validates the bounded task on an agent branch.
3. Substantive work remains for review. Low-risk work can receive explicit
   `gakucho-automerge` authorization on its linked issue.
4. The metadata-only governor denies sensitive paths and enables GitHub-native
   auto-merge only after required CI, CodeQL analysis, and final CodeQL security
   checks are enforced. It never publishes the extension.

If external access blocks the run, Symphony adds `symphony-blocked`, records the
reason in its single `## Symphony Workpad` issue comment, and removes
`symphony-ready`. Re-adding `symphony-ready` resumes the preserved workspace.

The local workflow expects `GITHUB_TOKEN` and `SYMPHONY_WORKSPACE_ROOT` in the
host service environment. Secrets must remain host-side; do not commit tokens
to this repository or its Codex Cloud environment.
