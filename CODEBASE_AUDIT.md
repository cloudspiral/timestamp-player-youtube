# Timestamp Player for YouTube — Codebase Audit

Date: 2026-07-10

Scope: architecture, YouTube lifecycle behavior, timestamp/source correctness, performance, accessibility, tests, tooling, and release safety

Revision reviewed: `a7091e9` (`master`)

## Executive summary

The reported “Tracklist does not appear until I refresh once” behavior has a high-confidence root cause:

- The extension is statically injected only into URLs matching `/watch*`.
- YouTube commonly starts the tab on Home, Search, Subscriptions, or a channel page and then changes to `/watch` with a same-document SPA navigation.
- A same-document navigation does not cause a static content script to be injected into a document that did not originally match.
- Refreshing on `/watch` creates a matching document and injects the extension. From that point forward, the already-running navigation listeners handle related-video transitions.

That sequence exactly matches the observed “one refresh primes it” behavior. The first fix should be to inject on all paths of the two supported YouTube origins, while keeping the heavy watch-page work dormant off `/watch`.

The codebase is otherwise a solid small extension with narrow permissions, conservative text rendering, a useful manual-video catalog, isolated parser/comment helpers, and simple packaging. The main structural risk is that `src/content.js` has grown to 2,506 lines and combines route lifecycle, asynchronous discovery, caches, YouTube DOM scraping, source selection, view construction, layout, playback, and rendering. The reported bug is one consequence of not having a single explicit watch-session lifecycle.

Current verification is green but narrow:

- `npm run check`: passes.
- Parser tests: 2 passed, 0 failed.
- `web-ext lint --source-dir .`: 0 errors, 0 warnings, 0 notices.
- No browser lifecycle test, source-selection suite, UI test, or CI workflow exists.

## Priority rubric

- **P0 — Immediate:** blocks the core feature in a normal browsing path.
- **P1 — High:** credible user-visible correctness/reliability problem or the main source of future regressions.
- **P2 — Medium:** concrete edge-case, performance, accessibility, or maintainability problem.
- **P3 — Low:** cleanup, defense in depth, or polish.

## Prioritized findings

| ID | Priority | Finding | Primary action |
|---|---:|---|---|
| F1 | P0 | Static content-script scope causes the refresh-to-prime bug | Match all paths on both YouTube origins; route-gate the watch controller |
| F2 | P1 | Watch-page readiness is an implicit, race-prone state machine | Add one generation-scoped `WatchSession` with bounded retries and cancellation |
| F3 | P1 | Comment fetching can block already-available fallbacks and fail permanently | Do DOM discovery immediately; add abort, timeout, typed outcomes, and retry |
| F4 | P1 | The first valid track set is permanently locked without provenance | Preserve source metadata and allow deterministic upgrades |
| F5 | P1 | Invalid/out-of-duration timestamps can produce impossible tracks | Validate clock fields and enforce `0 <= start < end <= duration` |
| F6 | P1 | Whole-document observation drives repeated full scans and list rebuilds | Narrow observers and make rendering incremental |
| F7 | P1 | Tests cover only two parser cases and miss every lifecycle boundary | Add pure-unit, DOM-fixture, and one browser-extension smoke layer |
| F8 | P1 | `content.js` owns too many unrelated responsibilities | Split by lifecycle, discovery, view, layout, and playback boundaries |
| F9 | P2 | The active video is selected with a first-global-video query | Resolve the video inside the active watch player |
| F10 | P2 | Per-video caches are unbounded and retain unused comment records | Add LRU/TTL eviction and discard raw records after scoring |
| F11 | P2 | Several player interactions are not keyboard/screen-reader operable | Use native controls and preserve focus |
| F12 | P2 | YouTube DOM interpretation is duplicated, English-dependent, and partly broken | Centralize a structural YouTube DOM adapter |
| F13 | P2 | Comment pin/like metadata can be inferred from unrelated body/toolbar text | Read known schema fields and test response fixtures |
| F14 | P2 | Mixed parser layouts and flat cross-source dedupe can select the wrong titles/run | Keep source boundaries and make nearby-title promotion candidate-local |
| F15 | P2 | Discovery failures are silent and intended status messages are discarded | Add an explicit discovery status and opt-in diagnostics |
| F16 | P2 | Tooling proves syntax, not behavior or packaged-browser compatibility | Add CI, generated-package assertions, and a Chrome load smoke |
| F17 | P3 | Dead/redundant paths obscure intent | Remove unreachable repeat-all/status wrappers and consolidate duplicates |
| F18 | P3 | Several smaller parser, motion, and request-hardening gaps remain | Add focused regressions and defense-in-depth validation |

---

## F1 — P0: static content-script scope causes the refresh-to-prime bug

### Evidence

[`manifest.json`](manifest.json#L27-L45) declares the runtime as a static content script, but the only matches are:

```json
"matches": [
  "https://www.youtube.com/watch*",
  "https://music.youtube.com/watch*"
]
```

All recovery behavior is inside that script: initial scanning and YouTube navigation listeners are registered in [`src/content.js`](src/content.js#L142-L166). If the script was never injected, none of those listeners exists.

Chrome’s own SPA extension tutorial explicitly notes that a content script is not reinjected when an SPA updates the address bar without reloading, and recommends watching the already-matching document for subsequent changes: [Chrome Extensions — Run scripts on every page](https://developer.chrome.com/docs/extensions/get-started/tutorial/scripts-on-every-tab#step-5).

### Why the symptom maps exactly

1. Load YouTube Home/Search/Subscriptions: the original document URL does not match `/watch*`.
2. Click a video: YouTube changes the URL and DOM without creating a new document.
3. The extension is absent, so there is no scanner and no launcher.
4. Refresh on `/watch`: a new matching document is created and all scripts are injected.
5. Click another related video: the injected script remains alive and handles `yt-navigate-finish`/URL changes.

This also explains why the behavior is intermittent: it depends on the URL that created the current document, not only the URL currently visible in the address bar.

### Recommended fix

Broaden the match patterns:

```json
"matches": [
  "https://www.youtube.com/*",
  "https://music.youtube.com/*"
]
```

Then make the bootstrap route-aware:

- Keep a lightweight navigation listener alive across the origin.
- Start the expensive watch controller only when `pathname === "/watch"` and a valid `v` exists.
- Stop/abort the active watch session when leaving that route.
- Delay `ensureUi()` and the broad source observers until a watch session starts.

Broadening the match without route gating would make the current whole-document observer run on YouTube’s busy Home/Search pages, so both changes belong in the same patch.

### Acceptance tests

1. Home → timestamped video, no reload.
2. Search → timestamped video, no reload.
3. Watch A → Watch B.
4. Watch → Home → Watch.
5. Direct `/watch` reload.
6. Equivalent YouTube Music routes, or remove the declared support if it is not intended.

A quick field diagnostic in a broken tab is:

```js
document.getElementById("timestamp-player-root")
```

`null` before refresh and a node afterward confirms that the content script was absent.

## F2 — P1: watch-page readiness is an implicit, race-prone state machine

The runtime state has three overlapping ownership IDs plus several per-video phase flags in [`src/content.js`](src/content.js#L78-L109):

- `currentVideoId`
- `tracksVideoId`
- `lockedTrackVideoId`
- multiple description/fallback/open/close video IDs
- two maps carrying cross-navigation state

Navigation is detected four ways:

- `yt-navigate-finish` on `document`
- the same event on `window`
- a whole-document `MutationObserver`
- a one-second URL poll

See [`src/content.js`](src/content.js#L142-L165) and [`src/content.js`](src/content.js#L234-L295). These mechanisms are individually defensive, but they do not share a single navigation generation or lifecycle owner. `handleNavigation()` also does not update `lastUrl`, so the interval may process the same route again.

Late hydration has additional gaps:

- The observer watches `childList`, but not late `href`, visibility, class, `aria-expanded`, or character-data changes.
- `scheduleScan()` keeps only one leading timeout rather than an explicit retry policy.
- A normal empty scan can finish without scheduling another readiness attempt.
- If tracks exist before the action row is visible, launcher mounting returns and depends on a later unrelated mutation to retry.
- `isLikelyCollapsedDescriptionTextRoot()` only recognizes an English “more” control and an ellipsis on the timestamp-bearing line ([`src/content.js`](src/content.js#L764-L775)).
- `canReadQuietDescription()` treats almost any other nonempty quiet root as complete ([`src/content.js`](src/content.js#L1139-L1148)), which can suppress the real description expansion.

### Recommended model

Use one navigation-scoped session:

```text
appState
  session
    generation
    videoId
    phase
    abortController
    discoveryStatus
    selectedSource
    tracks
  playback
  view
  preferences
```

Every route transition increments `generation`. A timer, observer callback, or async fetch may commit only when both generation and video ID still match. Give initial hydration a bounded retry window, for example a small backoff over 5–10 seconds, and separately retry launcher attachment while tracks exist but the action row does not.

This should replace—not merely wrap—the overlapping event/poll/flag behavior.

## F3 — P1: comment fetching can block fallbacks and fail permanently

The discovery flow waits for background comment fetching before it checks visible DOM comments or native moments. In [`src/content.js`](src/content.js#L347-L360), a pending fetch explicitly sets `tracks = []`; native fallback is also gated by `!commentFetchPending`.

Consequences:

- A visible pinned timestamp comment is ignored while the network fetch runs.
- A hung request can suppress all comment/native discovery indefinitely.
- A later continuation failure rejects the whole operation, discarding records from earlier successful batches ([`src/comment-fetching.js`](src/comment-fetching.js#L13-L43)).
- Fetches have no `AbortSignal` or timeout ([`src/comment-fetching.js`](src/comment-fetching.js#L74-L84), [`src/comment-fetching.js`](src/comment-fetching.js#L280-L313)).
- `failed` and completed-empty states are cached as terminal for the life of the document ([`src/content.js`](src/content.js#L844-L883)).
- “No comments,” “stale page data,” “unsupported response shape,” and “transient network failure” collapse into the same empty result.

This is a second plausible refresh-sensitive path for videos whose useful timestamps live in comments: refresh recreates the in-memory cache.

### Recommended fix

- Scan visible DOM comments immediately.
- Start fetched-comment discovery concurrently as an upgrade path.
- Allow a provisional native result while comments are pending.
- Pass the session `AbortSignal` through the watch-page and continuation requests.
- Apply a bounded timeout.
- Return partial records if batch 1 succeeded and batch 2 failed.
- Use typed results: `success`, `partial`, `no-results`, `transient-error`, `unsupported`.
- Retry transient/unsupported outcomes once with cooldown/backoff; do not permanently cache them as definitive emptiness.

## F4 — P1: the first valid track set is permanently locked without provenance

Any result with two tracks is locked in [`src/content.js`](src/content.js#L368-L370). Every later scan returns early from that lock in [`src/content.js`](src/content.js#L320-L330).

The cache stores only a track array, so it loses:

- source kind (description text, description links, fetched comment, DOM comment, native)
- source completeness/readiness
- confidence/quality
- observation generation/time
- why a result beat another result

`chooseBetterTrackSet()` compares only the number of titled tracks ([`src/content.js`](src/content.js#L480-L485)). It cannot enforce the intended source order or identify a safe upgrade.

This can permanently preserve:

- a two-track partial description before a ten-track list finishes rendering
- stale un-linkified description text from the preceding SPA route
- a provisional native list that later comments should replace
- poorer labels for the same starts

The stale-root risk is real because `timestampTextRootMatchesVideo()` accepts a root with no timestamp links as belonging to any current video ([`src/content.js`](src/content.js#L752-L762)).

### Recommended abstraction

Introduce a source result:

```js
{
  kind: "description-text",
  generation: 12,
  videoId: "...",
  status: "provisional",
  candidates: [],
  tracks: [],
  quality: {},
  observedAt: 0
}
```

Keep the current intended preference explicit:

1. Current-video description.
2. Fetched or visible comment source, scored deterministically.
3. Native YouTube moments as provisional fallback.

Allow monotonic upgrades: longer same-prefix description runs, stronger titles for the same starts, or a real source replacing native fallback. Mark a result final only when its relevant source has settled.

## F5 — P1: invalid/out-of-duration timestamps can create impossible tracks

`parseTimestampText()` validates only the shape, not clock component ranges ([`src/timestamps.js`](src/timestamps.js#L149-L160)):

```text
1:99 -> 159 seconds
```

`findTracks()` does not filter candidates against video duration ([`src/timestamps.js`](src/timestamps.js#L7-L25)). A confirmed local probe produced:

```js
findTracks(60, [0, 90])
// final track: { start: 90, end: 60 }
```

Long unrelated timestamps in a description/comment can therefore create tracks that start after the video ends or make an earlier track extend far beyond the video.

### Recommended invariants

- Reject seconds `>= 60`.
- In `h:mm:ss`, reject minutes `>= 60`.
- Filter starts outside `[0, duration)` with a small rounding tolerance.
- Require every emitted interval to satisfy `0 <= start < end <= duration`.
- Reject or deliberately merge zero-length/near-duplicate intervals.

Add direct tests before changing the parser.

## F6 — P1: whole-document observation drives repeated full work

The observer covers `document.documentElement` and every descendant ([`src/content.js`](src/content.js#L149-L152)). Almost every non-extension mutation schedules a scan ([`src/content.js`](src/content.js#L270-L295)).

Even after tracks are locked, a scan applies tracks and calls `updateUi()`. `updateUi()` then:

- rechecks/moves launcher/player DOM
- updates every control
- destroys and recreates every track-list button
- runs layout

See [`src/content.js`](src/content.js#L320-L330), [`src/content.js`](src/content.js#L2390-L2417), and [`src/content.js`](src/content.js#L2452-L2502).

This is unnecessary work on a page with constant mutations and is especially visible for the documented 60+ track case. It also causes a correctness/accessibility issue: activating a track calls `updateUi()`, which deletes the focused button.

### Recommended fix

- Use route/readiness events plus a narrow observer around current watch metadata, description, comments, and action-row replacement.
- Stop general discovery after a result is stable, aside from explicit upgrade observers.
- Split render operations:
  - track collection changed
  - active track changed
  - playback state changed
  - progress changed
  - layout changed
- Create keyed list buttons once; update `is-active`/`aria-current` in place.
- Add a test that a mutation storm produces bounded scan/render counts.

## F7 — P1: automated coverage misses nearly all behavior

[`tests/timestamps.test.mjs`](tests/timestamps.test.mjs#L1-L51) contains two tests. [`package.json`](package.json#L4-L13) otherwise checks JavaScript syntax and JSON parsing. There is no CI workflow.

Uncovered behavior includes:

- cold Home/Search → Watch activation
- Watch A → Watch B → no-timestamp C
- late description/action-row hydration
- stale async completion after navigation
- source precedence and upgrades
- comment response parsing/continuation selection
- native timestamp DOM extraction
- settings normalization/storage adapters
- shuffle/history/repeat/seek boundaries
- launcher removal/reinsertion
- focus and keyboard behavior
- generated Chrome/Firefox package contents

`TEST_VIDEOS.md` is a good manual catalog, but it cannot catch the manifest lifecycle bug in CI.

### Recommended test layers

1. **Pure unit tests:** parser invariants, source reducer, playback state, scoring, settings.
2. **DOM fixtures:** description states, native cards, action row, comments, localized controls.
3. **Async session tests:** navigation generation, timeout, abort, retry, provisional upgrade.
4. **One browser-extension smoke suite:** load the unpacked generated Chrome package and exercise a mocked YouTube-origin SPA flow.
5. **Manual videos:** retain the current real-world catalog as release validation.

The first browser regression must begin on a non-watch URL. Starting directly on `/watch` would miss F1.

## F8 — P1: `content.js` owns too many unrelated responsibilities

The 2,506-line file currently contains:

| Lines | Responsibility |
|---|---|
| 78–140 | application state and DOM references |
| 142–387 | initialization, navigation, scanning |
| 408–485 | track caching/locking |
| 488–833 | video/description DOM discovery |
| 835–1170 | comment discovery/selection |
| 1172–1305 | link-to-candidate DOM parsing |
| 1307–1515 | player DOM construction/mounting |
| 1517–2019 | drag, resize, and layout |
| 2021–2352 | playback and queue behavior |
| 2390–2503 | rendering |

The issue is not line count alone. These sections change for different reasons, need different tests, and share mutable state implicitly.

### Recommended boundaries

- `content.js`: composition/bootstrap only.
- `watch-session.js`: route lifecycle, generation, retries, cancellation, discovery status.
- `youtube-dom.js`: selectors, active player, description/comment/native extraction.
- `track-discovery.js`: source provenance, precedence, upgrades, cache policy.
- `playback-state.js`: pure shuffle/history/repeat/seek transitions.
- `player-view.js`: stable DOM, ARIA, incremental rendering.
- `player-layout.js`: anchoring, floating, drag, resize, persisted geometry.

Keep `timestamps.js`, `comment-scoring.js`, and settings normalization as mostly pure helpers. A class-heavy rewrite is unnecessary; focused functions with explicit inputs/outputs are enough. A bundler is optional—classic scripts can remain if a small namespace/dependency guard is added.

## F9 — P2: active video selection is not SPA-specific enough

`getVideo()` returns the first global `video.html5-main-video`, then the first global video ([`src/content.js`](src/content.js#L488-L490)).

During navigation, YouTube can transiently contain stale, hidden, mini-player, preview, or ad-related video elements. The wrong duration/current time can then feed discovery and playback.

Resolve the video from the active watch player/watch renderer first, verify it belongs to the current session, and use visibility/readiness as tie-breakers. Keep the global query only as a fallback.

## F10 — P2: per-video caches grow for the life of the tab

`trackCache` and `commentFetchCache` are unbounded maps ([`src/content.js`](src/content.js#L96-L97)). They are never evicted during a long YouTube session.

The comment cache also retains raw `records` after tracks have already been selected ([`src/content.js`](src/content.js#L866-L874)); nothing reads them later.

Use a small LRU or TTL cache, store only the normalized result needed for reuse, and delete aborted/transient entries. A generation-scoped active result plus perhaps 10–20 recent video entries is enough.

## F11 — P2: keyboard and assistive-technology support is incomplete

Concrete issues:

- The seek control is a generic pointer-only `div`, without slider role, focusability, value ARIA, or keyboard controls ([`src/content.js`](src/content.js#L1354-L1357), [`src/content.js`](src/content.js#L2221-L2271)).
- The duration/remaining toggle is a `span role="button"` with no tab stop or Enter/Space behavior ([`src/content.js`](src/content.js#L1352-L1353), [`src/content.js`](src/content.js#L1431-L1434)).
- The now-playing title is a clickable `div`, not a button ([`src/content.js`](src/content.js#L1345-L1348)).
- Drag/resize handles are `aria-hidden` and pointer-only.
- The current list item has a visual class but no `aria-current`.
- Shuffle/repeat do not expose `aria-pressed`.
- The launcher has `aria-pressed` but not `aria-expanded`/`aria-controls`.
- Closing does not return focus to the launcher.
- The stylesheet has extensive hover rules but no scoped `:focus-visible` rules.
- Rebuilding the list deletes focused controls.

Prefer native `<button>` and `<input type="range">` elements. Add a named panel region, explicit disclosure relationship, Escape/close focus behavior, keyboard-accessible layout reset/move/resize controls, and focus-preservation tests.

## F12 — P2: YouTube DOM interpretation needs one structural adapter

There is concrete duplication:

- `getTimestampTextCandidateRoots()` and `getTimestampCandidateRoots()` are identical ([`src/content.js`](src/content.js#L813-L833)).
- Timestamp-link ownership/parsing is separately implemented for descriptions, comments, and native moments.
- Description/action/owner/comment selectors are spread across the orchestration file.

There are also confirmed correctness gaps:

- `NATIVE_TIMESTAMP_ITEM_SELECTOR` includes the anchor itself, so `link.closest(...)` always finds the link before the intended card/item container; the fallback uses only its parent ([`src/native-timestamps.js`](src/native-timestamps.js#L7-L11), [`src/native-timestamps.js`](src/native-timestamps.js#L92-L98)).
- Native section isolation relies on English “Key moments”/“Chapters” text ([`src/content.js`](src/content.js#L782-L795), [`src/native-timestamps.js`](src/native-timestamps.js#L21-L27)).
- Description expand/collapse fallback and pinned-comment fallback also inspect English UI text.
- Launcher placement searches for visible “share” text.
- YouTube Music is declared in the manifest but has no dedicated fixture/test coverage.

Create one `youtube-dom.js` adapter that:

- resolves the active watch renderer and video
- identifies current-video roots structurally
- parses a timestamp link into one normalized shape
- removes known native DOM containers before text extraction
- centralizes selector fallbacks
- keeps localized text matching as a last resort, not primary evidence

## F13 — P2: comment metadata extraction can misclassify sources

`containsCommentFlag()` serializes an entire comment object and searches for a word ([`src/comment-fetching.js`](src/comment-fetching.js#L462-L464)). That means ordinary comment text such as “I copied the pinned comment” can set `isPinned: true` through [`src/comment-fetching.js`](src/comment-fetching.js#L357-L375).

False pinning adds source-trust weight and can choose the wrong timestamp list. The DOM fallback’s broad “pinned by” text check has a related risk.

Like extraction is also broad: it walks every string in a toolbar object, then accepts the first number-like text ([`src/comment-fetching.js`](src/comment-fetching.js#L434-L459), [`src/comment-scoring.js`](src/comment-scoring.js#L55-L72)). Dates or unrelated counts can become likes.

Read known badge/creator/vote schema fields and like-labelled accessibility values. Exclude comment body text from status detection. Add fixtures for both current renderer families plus negative cases containing “pinned” and unrelated numbers.

When duplicate representations of one comment are found, merge richer metadata rather than keeping whichever representation appeared first.

## F14 — P2: mixed layouts and flat candidate handling can choose the wrong result

Two confirmed parser/source-shape problems:

1. `hasBlockTitlePattern()` computes one global layout flag. When enough entries have weak titles, `enrichCandidateTitlesFromNearbyLines()` may replace a valid same-line title with the next contextual line ([`src/timestamps.js`](src/timestamps.js#L257-L293)).
2. `getFirstCandidatePerLine()` deduplicates identical starts globally before run selection ([`src/timestamps.js`](src/timestamps.js#L28-L53)). When two source roots share some starts, candidates from the later, better source can be removed and its run destroyed.

Candidate title enrichment should be local to each candidate or coherent source block. Source comparison should happen after building a valid run within each source, not after flattening every root into one array.

Add:

- a mixed same-line/block-layout fixture
- two competing source roots with overlapping starts
- source-order and same-start title-quality cases

## F15 — P2: discovery is silent and intended statuses are discarded

Errors are swallowed in comment/page-data paths. More visibly, `scanPage()` calls:

- `updateUi("Open a YouTube video")`
- `updateUi("Reading description...")`

at [`src/content.js`](src/content.js#L306-L345), but `updateUi()` accepts no parameter and the player shell has no status element ([`src/content.js`](src/content.js#L1307-L1435), [`src/content.js`](src/content.js#L2452-L2503)).

The intended status API is dead, so “still discovering,” “no timestamps,” “comment fetch timed out,” and “extension absent” all look like no button.

Add an explicit discovery status to the session. A visible loading UI is optional, but an opt-in namespaced debug log should record:

- generation/video ID
- source attempts and candidate/track counts
- selected source and reason
- retry/timeout/abort state
- launcher attachment state

Keep this off by default and never log comment bodies or private tokens.

## F16 — P2: tooling proves syntax, not packaged behavior

The current `check:js` command manually enumerates files ([`package.json`](package.json#L4-L8)); a new file is unchecked unless the script is edited. The manifest check proves only that JSON parses. Firefox package lint is useful, but there is no generated Chrome load/schema smoke.

Recommended improvements:

- Add a supported Node version via `engines` and/or `.nvmrc`.
- Use a small check script or linter that discovers source/test files automatically.
- Add CI for `npm ci`, checks, package preparation, Firefox lint, generated-manifest/file assertions, and a Chromium extension load smoke.
- Test that Chrome output omits Firefox-only settings and that both outputs contain every declared script/style/icon.
- Keep the current packaging script; it is simple and readable.

## F17 — P3: dead and redundant paths obscure intent

Examples:

- `REPEAT_MODES.ALL` is defined and handled, but `toggleRepeat()` can produce only `off` or `one`.
- `getCurrentTrack()` only calls `getTrackAtTime()`.
- The two timestamp-root selector functions are identical.
- `mountPlayerForMode()` moves the player to the same overlay root in both branches.
- Navigation is processed through overlapping event/observer/poll paths.
- `PROGRESS_TIME_MODES` exists in two different shapes across content/settings code.
- Runtime settings are stored both in `state.settings` and mirrored layout/progress fields.
- Status arguments passed to `updateUi()` are unused.

Remove genuinely dead paths, and consolidate only where one invariant becomes clearer. Do not build a generic framework for a small options form.

## F18 — P3: smaller confirmed gaps

### Parser correctness

- `lineContainingTimestamp()` uses substring matching, so searching `1:00` can return a preceding `11:00` line ([`src/timestamps.js`](src/timestamps.js#L162-L165)).
- Numeric-prefix cleanup can corrupt decimal-leading titles such as `99.9% Pure` or `3.14159` ([`src/timestamps.js`](src/timestamps.js#L370-L379)).
- Adjacent timestamp starts under 0.2 seconds can produce zero-length intervals.

### Runtime behavior

- A live/invalid `video.duration` can trigger a scan every 600 ms forever ([`src/content.js`](src/content.js#L312-L315)). Prefer `loadedmetadata`/`durationchange`, identify live content, and bound retries.
- Progress end handling subtracts both the parser’s 0.2-second inter-track gap and a 0.35-second grace before repeat/shuffle seeks ([`src/timestamps.js`](src/timestamps.js#L17-L24), [`src/content.js`](src/content.js#L2291-L2305)). Add boundary tests to ensure audio is not cut early.

### Accessibility/polish

- Respect `prefers-reduced-motion` for transitions and smooth list scrolling.
- Keep options-page save errors visible longer than successful saves.
- Disable or guard the options form until stored settings finish loading.

### Defense in depth

`fetchContinuation()` accepts an absolute `apiUrl` from response data and performs a credentialed request ([`src/comment-fetching.js`](src/comment-fetching.js#L280-L305)). Restrict the URL to the current YouTube origin and expected `/youtubei/` path before sending the continuation context/token.

---

## What is already good

- The extension requests only `storage`; there is no broad background/service-worker permission surface.
- Dynamic track titles are rendered with `textContent`, while observed `innerHTML` is static extension-owned markup.
- The pure timestamp parser is already separated from DOM scraping.
- Comment scoring and fetched-comment parsing have their own modules.
- Settings values are normalized before use and storage has a cross-browser adapter.
- Video ownership checks and stale-scan guards show good awareness of SPA hazards.
- The packaging script is small, deterministic, and easy to inspect.
- `TEST_VIDEOS.md` captures valuable real-world regressions and should remain part of releases.
- The recent decorated-track-number fix lives in the right shared parser layer and has a regression test.

The refactor should preserve these strengths and put a clearer lifecycle/source boundary around them, not replace the project wholesale.

## Recommended implementation order

### Phase 1 — Fix the core bug

1. Broaden YouTube match patterns.
2. Add a route-aware bootstrap that starts/stops watch work.
3. Add the cold Home/Search → Watch browser regression.
4. Add bounded launcher/description readiness retries.

### Phase 2 — Make discovery reliable

1. Introduce a generation-scoped watch session and `AbortController`.
2. Stop comment fetches from blocking DOM/native fallbacks.
3. Add timeout, typed outcomes, partial results, and retry.
4. Add structural current-video description ownership.

### Phase 3 — Make source selection explicit

1. Introduce source provenance/quality/status.
2. Replace permanent first-result locking with deterministic upgrades.
3. Keep candidate runs grouped by source.
4. Add duration/clock invariants and parser regressions.

### Phase 4 — Split the content script safely

1. Extract pure playback state.
2. Extract the YouTube DOM adapter.
3. Extract stable player view/rendering.
4. Extract layout/drag/resize.
5. Leave `content.js` as composition.

Move one boundary at a time with tests; avoid a flag-day rewrite.

### Phase 5 — Performance, accessibility, and release maturity

1. Narrow observers and stop stable-session scans.
2. Make track rendering keyed/incremental.
3. Replace custom pointer-only controls with native accessible controls.
4. Bound caches.
5. Add CI and generated-package/browser smoke checks.

## Definition of done for the reported issue

- Starting from any supported non-watch YouTube route, the first timestamped video shows Tracklist without refresh.
- The same holds for Watch → Home → Watch and Watch A → Watch B.
- A description/action row that hydrates several seconds late still succeeds.
- A failed or hung comment request does not block visible comments or native fallback forever.
- Stale work from video A cannot update video B.
- The scanner becomes quiescent after the session is stable.
- The regression runs against the packaged extension, not only imported helper functions.

## Verification performed for this audit

- Inspected every tracked runtime, options, build, and test file, plus the project documentation relevant to behavior and release flow.
- Reviewed recent commits related to SPA state, quiet descriptions, source priority, and parser behavior.
- Ran `npm run check`: pass.
- Ran `web-ext lint --source-dir .`: 0 errors, 0 warnings, 0 notices.
- Ran focused read-only parser probes for invalid clock fields, out-of-duration tracks, and overlapping-source starts.
- Inspected the working tree before writing this report; it was clean.
- Did not run the unpacked extension in a live YouTube tab; F1 is a static diagnosis corroborated by official browser behavior and the exact symptom sequence.

No runtime code was changed as part of this audit.
