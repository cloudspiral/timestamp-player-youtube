# Browser Extension Release Checklist

Use this checklist to turn a reviewed release commit into production-ready
Chrome and Firefox artifacts. Run it from a clean checkout, keep the command
results with the release record, and use the exact final artifacts for manual
testing and store upload.

This checklist stops at artifact and evidence handoff. Chrome Web Store and
Firefox Add-ons upload, submission, and publication are human-only actions.
Automated agents must not publish, create a release or tag, merge, or change
repository settings.

## 1. Start from a clean, fixed checkout

- [ ] Choose the reviewed release commit and record its full SHA.
- [ ] Clone a new checkout and detach it at that exact commit.
- [ ] Confirm the checkout has no local changes.
- [ ] Use Node.js 22, as pinned by `.nvmrc` and required by `package.json`.
- [ ] Install only the dependency graph locked in `package-lock.json` with
  `npm ci`; do not substitute `npm install`.
- [ ] Confirm installation did not change tracked files.

```sh
git clone https://github.com/cloudspiral/timestamp-player-youtube.git
cd timestamp-player-youtube
git checkout --detach <release-commit>
git rev-parse HEAD
test -z "$(git status --porcelain)"
node --version
npm ci
test -z "$(git status --porcelain)"
```

Expected Node output starts with `v22`. If any clean-tree check fails, stop and
restart from a clean checkout rather than packaging a modified tree.

## 2. Confirm version and package-source integrity

`manifest.json` is the canonical extension version. The build scripts use that
version for both archive names; `package.json` intentionally has no separate
extension version.

- [ ] Confirm `manifest.json` contains the approved release version.
- [ ] Confirm the Chrome and Firefox store records are ready to receive that
  same version. Store-dashboard verification is human-only.
- [ ] Confirm `dist/` and `web-ext-artifacts/` contain no tracked files.
- [ ] Never edit `dist/chrome`, `dist/firefox`, or an artifact archive by hand.
  Make changes in `manifest.json`, `src/`, `icons/`, `options.html`, or other
  source inputs, then regenerate.
- [ ] Generate and verify both package trees.
- [ ] Confirm all three generated/source manifests report the same version.

```sh
test -z "$(git ls-files 'dist/**' 'web-ext-artifacts/**')"
npm run verify:packages
node -e 'const fs=require("node:fs");const paths=["manifest.json","dist/chrome/manifest.json","dist/firefox/manifest.json"];const versions=paths.map((path)=>JSON.parse(fs.readFileSync(path,"utf8")).version);console.log(paths.map((path,index)=>`${path}: ${versions[index]}`).join("\n"));if(!versions.every((version)=>version===versions[0]))process.exit(1)'
```

`npm run verify:packages` is the integrity proof: it recreates both `dist/`
trees, checks the expected Chrome/Firefox manifest transform, validates every
referenced runtime file, rejects unexpected files, and compares copied runtime
bytes with source. A passing result is evidence that generated package sources
were not used as an independent hand-edited source of truth.

## 3. Capture automated evidence

Run every command separately so each gate has an explicit result. `npm run
build` repeats several gates by design and then produces both archives.

- [ ] `npm run check` passes syntax checks, manifest parsing, and the complete
  automated test suite.
- [ ] `npm run verify:packages` passes generated-manifest, asset, runtime
  coverage, and byte-for-byte source checks.
- [ ] `npm run lint:firefox` passes `web-ext` validation of `dist/firefox`.
- [ ] `npm run smoke:chrome` passes the packaged Chrome cold-SPA scenarios for
  standard YouTube Watch and YouTube Music. This requires Chrome/Chromium and
  OpenSSL; set `CHROME_BIN` if needed.
- [ ] `npm run build` passes and creates both final archives.

```sh
npm run check
npm run verify:packages
npm run lint:firefox
npm run smoke:chrome
npm run build
```

Record the exact invocation, not a paraphrase:

| Gate | Result | Date / release SHA | Evidence or notes |
| --- | --- | --- | --- |
| `npm ci` | PASS / FAIL |  |  |
| `npm run check` | PASS / FAIL |  |  |
| `npm run verify:packages` | PASS / FAIL |  |  |
| `npm run lint:firefox` | PASS / FAIL |  |  |
| `npm run smoke:chrome` | PASS / FAIL |  |  |
| `npm run build` | PASS / FAIL |  |  |

Do not replace a failed or skipped automated gate with manual evidence. Resolve
the failure and rerun it from the release checkout.

## 4. Verify and identify the final artifacts

For manifest version `<version>`, the only expected upload artifacts are:

- `web-ext-artifacts/timestamp-player-youtube-chrome-<version>.zip`
- `web-ext-artifacts/timestamp-player-youtube-firefox-<version>.zip`

- [ ] Confirm exactly those two versioned ZIP files exist.
- [ ] Confirm each ZIP's embedded manifest version matches `manifest.json`.
- [ ] Record the SHA-256 checksum and size of each final ZIP after all builds
  are complete. Any rebuild invalidates earlier checksums and manual evidence.
- [ ] Confirm tracked files are still unchanged.

```sh
release_version="$(node -p 'require("./manifest.json").version')"
chrome_zip="web-ext-artifacts/timestamp-player-youtube-chrome-${release_version}.zip"
firefox_zip="web-ext-artifacts/timestamp-player-youtube-firefox-${release_version}.zip"
test -f "$chrome_zip" && test -f "$firefox_zip"
test "$(find web-ext-artifacts -maxdepth 1 -type f -name '*.zip' | wc -l | tr -d ' ')" -eq 2
unzip -p "$chrome_zip" manifest.json | node -e 'let body="";process.stdin.on("data",chunk=>body+=chunk).on("end",()=>console.log(JSON.parse(body).version))'
unzip -p "$firefox_zip" manifest.json | node -e 'let body="";process.stdin.on("data",chunk=>body+=chunk).on("end",()=>console.log(JSON.parse(body).version))'
shasum -a 256 "$chrome_zip" "$firefox_zip"
ls -lh "$chrome_zip" "$firefox_zip"
test -z "$(git status --porcelain)"
```

| Artifact | Expected path | SHA-256 | Size | Embedded version |
| --- | --- | --- | --- | --- |
| Chrome | `web-ext-artifacts/timestamp-player-youtube-chrome-<version>.zip` |  |  |  |
| Firefox | `web-ext-artifacts/timestamp-player-youtube-firefox-<version>.zip` |  |  |  |

## 5. Capture real-browser evidence

Automated fixtures do not replace manual release testing against current
YouTube. Extract each final ZIP into a fresh directory outside the repository,
then load that exact package using the
[`Chrome / Brave`](README.md#chrome-or-brave) or
[`Firefox`](README.md#firefox) flow, selecting the extracted directory or
manifest instead of `dist/`. Do not test a stale installed copy. Use
[`TEST_VIDEOS.md`](TEST_VIDEOS.md) as the maintained real-world catalog and
follow the testing boundary in [`TESTING.md`](TESTING.md#manual-release-checks).

Run the following in both Chrome/Brave and Firefox unless a limitation is
explicitly recorded and approved by the human release owner:

- [ ] **Cold SPA entry:** start at YouTube Home or Search and open the first
  timestamped video through YouTube navigation without reloading. Confirm the
  Tracklist launcher and parsed tracks appear. Also exercise the equivalent
  cold route on YouTube Music.
- [ ] **SPA navigation:** navigate Watch A to Watch B, then Watch to Home to
  Watch, without reloading. Confirm the launcher, source, active track, and
  controls belong only to the current video.
- [ ] **Source variants:** verify a description tracklist, a visible-comment
  tracklist, a fetched-comment tracklist, and the native Key Moments fallback.
  Confirm the documented source precedence is preserved.
- [ ] **Catalog coverage:** use at least one representative from every relevant
  `TEST_VIDEOS.md` section: Timestamped Albums, Long Compilations, YouTube
  Chapters, Native Key Moments Fallback, Timestamps in Comments, Messy
  Timestamp Formats, and Edge Cases. Re-run every listed regression case
  related to the release's changed behavior.
- [ ] **Player layouts and playback:** exercise anchored, compact, floating,
  and fullscreen layouts, plus shuffle and repeat. In compact mode, also check
  pointer resize, double-click title fitting, and title avoidance.
- [ ] **Keyboard focus:** on a long tracklist, navigate the player with the
  keyboard while the active track changes. Confirm focus remains visible and
  usable, playback does not steal it unexpectedly, and closing the player
  returns focus to the launcher.
- [ ] **No-track behavior:** use the catalog's no-timestamps case and confirm no
  Tracklist launcher appears.

Manual evidence must identify the browser/version, tested artifact checksum,
video or catalog case, result, and any screenshot/video/log reference.

| Scenario | Chrome / Brave result | Firefox result | Evidence or notes |
| --- | --- | --- | --- |
| Cold SPA entry: Watch and Music | PASS / FAIL / BLOCKED | PASS / FAIL / BLOCKED |  |
| Watch-to-Watch and Watch-Home-Watch | PASS / FAIL / BLOCKED | PASS / FAIL / BLOCKED |  |
| Description, visible/fetched comment, native sources | PASS / FAIL / BLOCKED | PASS / FAIL / BLOCKED |  |
| Catalog and parser regression samples | PASS / FAIL / BLOCKED | PASS / FAIL / BLOCKED |  |
| Anchored, compact, floating, fullscreen | PASS / FAIL / BLOCKED | PASS / FAIL / BLOCKED |  |
| Shuffle and repeat | PASS / FAIL / BLOCKED | PASS / FAIL / BLOCKED |  |
| Long-tracklist keyboard focus | PASS / FAIL / BLOCKED | PASS / FAIL / BLOCKED |  |
| No-timestamps case | PASS / FAIL / BLOCKED | PASS / FAIL / BLOCKED |  |

## 6. Record limitations and hand off to a human

Automated evidence and real-browser evidence are separate release requirements.
Record every skipped, blocked, environment-specific, or known-broken case; an
empty table means no known limitations were accepted.

| Known limitation or unverified case | Impact | Owner / follow-up | Human approval |
| --- | --- | --- | --- |
|  |  |  |  |

- [ ] A human release owner reviewed the commit SHA, gate results, manual
  evidence, artifact names, embedded versions, checksums, and limitations.
- [ ] **HUMAN ONLY:** upload the recorded Chrome ZIP to the Chrome Web Store.
- [ ] **HUMAN ONLY:** upload the recorded Firefox ZIP to Firefox Add-ons.
- [ ] **HUMAN ONLY:** review each store's validation and listing changes, then
  decide whether and when to submit or publish.
- [ ] Confirm the uploaded files' names and checksums still match this record.

Store credentials and dashboards are not part of repository automation. Tags,
GitHub releases, merges, and repository-setting changes are also outside this
checklist and require separate human authorization and policy.
