import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadTrackSelection() {
  const [timestampsSource, source] = await Promise.all([
    readFile(new URL("../src/timestamps.js", import.meta.url), "utf8"),
    readFile(new URL("../src/track-selection.js", import.meta.url), "utf8"),
  ]);
  const context = vm.createContext({});
  vm.runInContext(timestampsSource, context);
  vm.runInContext(source, context);
  return context.TimestampPlayerTrackSelection;
}

function tracks(starts, titles = [], duration = 600) {
  return starts.map((start, index) => ({
    index,
    start,
    end: starts[index + 1] ?? duration,
    title: titles[index] || "",
  }));
}

function result(api, {
  channel,
  chapterKind,
  duration = 600,
  generation = 1,
  kind,
  observation = 1,
  ownership = { confidence: api.OWNERSHIP_CONFIDENCE.STRONG },
  sourceId,
  sourceScore = 0,
  starts = [0, 60],
  status = api.TRACK_SOURCE_STATUSES.PROVISIONAL,
  titles = [],
  videoId = "album",
} = {}) {
  return api.createTrackSourceResult({
    channel: channel || `${kind}-fixture`,
    chapterKind,
    duration,
    generation,
    kind,
    observation,
    ownership,
    sourceId: sourceId || `${kind}-source`,
    sourceScore,
    status,
    tracks: tracks(starts, titles, duration),
    videoId,
  });
}

function consider(api, selection, candidate, duration = 600) {
  return api.considerTrackSource(selection, candidate, {
    duration,
    generation: 1,
    videoId: "album",
  });
}

test("deterministic source tiers upgrade native to comments to description", async () => {
  const api = await loadTrackSelection();
  const selection = api.createTrackSelectionState();

  consider(api, selection, result(api, { kind: api.TRACK_SOURCE_KINDS.NATIVE }));
  assert.equal(selection.current.source.kind, api.TRACK_SOURCE_KINDS.NATIVE);

  consider(api, selection, result(api, {
    kind: api.TRACK_SOURCE_KINDS.COMMENT,
    sourceId: "pinned-comment",
  }));
  assert.equal(selection.current.source.kind, api.TRACK_SOURCE_KINDS.COMMENT);

  consider(api, selection, result(api, {
    kind: api.TRACK_SOURCE_KINDS.DESCRIPTION,
    sourceId: "description",
  }));
  assert.equal(selection.current.source.kind, api.TRACK_SOURCE_KINDS.DESCRIPTION);

  consider(api, selection, result(api, {
    kind: api.TRACK_SOURCE_KINDS.COMMENT,
    sourceId: "longer-comment",
    starts: [0, 30, 60, 90, 120],
    titles: ["A", "B", "C", "D", "E"],
  }));
  assert.equal(selection.current.source.kind, api.TRACK_SOURCE_KINDS.DESCRIPTION);
});

test("manual chapters beat description; complete automatic and unknown chapters beat every comment", async () => {
  const api = await loadTrackSelection();
  for (const chapterKind of ["automatic", "unknown"]) {
    const selection = api.createTrackSelectionState();
    const comment = result(api, {
      kind: api.TRACK_SOURCE_KINDS.COMMENT,
      starts: [120, 240, 360],
      titles: ["A reaction", "Another reaction", "Random observation"],
      sourceScore: 10000,
    });
    consider(api, selection, comment);
    const chapter = result(api, {
      kind: "chapter", chapterKind, channel: "chapter-markers",
      starts: [0, 100, 300], titles: ["Intro", "Part one", "Part two"],
    });
    consider(api, selection, chapter);
    assert.equal(selection.current.source.kind, "chapter");
    assert.equal(api.shouldConsiderNativeSource(selection), true);
    consider(api, selection, comment);
    assert.equal(selection.current.source.kind, "chapter");
    consider(api, selection, result(api, { kind: "description" }));
    assert.equal(selection.current.source.kind, "description");
    consider(api, selection, result(api, {
      kind: "chapter", chapterKind: "manual", channel: "chapter-panel",
    }));
    assert.equal(selection.current.source.chapterKind, "manual");
  }
});

test("chapter classification wins before marker, structured-panel and DOM detection precedence", async () => {
  const api = await loadTrackSelection();
  const selection = api.createTrackSelectionState();
  for (const channel of ["chapter-dom", "chapter-panel", "chapter-markers"]) {
    consider(api, selection, result(api, {
      kind: "chapter", chapterKind: "automatic", channel,
      sourceId: channel, titles: [channel, "Ending"],
    }));
    assert.equal(selection.current.source.channel, channel);
  }
  consider(api, selection, result(api, {
    kind: "chapter", chapterKind: "unknown", channel: "chapter-dom",
    sourceId: "longer-dom", starts: [0, 10, 20, 30],
  }));
  assert.equal(selection.current.source.channel, "chapter-markers");
  consider(api, selection, result(api, {
    kind: "chapter", chapterKind: "manual", channel: "chapter-dom", sourceId: "creator",
  }));
  assert.equal(selection.current.source.id, "creator");
});

test("chapter source ties remain stable and a same-source prefix expansion stays coherent", async () => {
  const api = await loadTrackSelection();
  const selection = api.createTrackSelectionState();
  const make = (sourceId, starts) => result(api, {
    kind: "chapter", chapterKind: "automatic", channel: "chapter-markers", sourceId, starts,
    titles: starts.map((start) => `Section ${start}`),
  });
  consider(api, selection, make("first", [0, 60]));
  consider(api, selection, make("second", [0, 60]));
  assert.equal(selection.current.source.id, "first");
  consider(api, selection, make("first", [0, 60, 120]));
  assert.deepEqual(Array.from(selection.current.tracks, (track) => track.start), [0, 60, 120]);
  consider(api, selection, make("first", [0, 60]));
  assert.equal(selection.current.tracks.length, 3);
});

test("comment and cached title donors cannot rewrite nonempty authoritative chapter labels", async () => {
  const api = await loadTrackSelection();
  const selection = api.createTrackSelectionState();
  const chapter = result(api, {
    kind: "chapter", chapterKind: "manual", channel: "chapter-markers",
    starts: [0, 60, 120], titles: ["1984 / Live...", "", "The Finale..."],
  });
  const comment = result(api, {
    kind: "comment", starts: [0, 60, 120], titles: ["Wrong first title", "Missing title", "Wrong finale"],
  });
  consider(api, selection, chapter);
  consider(api, selection, comment);
  assert.deepEqual(Array.from(selection.current.tracks, (track) => track.title), ["1984 / Live...", "Missing title", "The Finale..."]);
  const cached = api.createTrackTitleCacheEntry(comment);
  const enriched = api.enrichTrackSourceFromCache(chapter, cached);
  assert.equal(enriched.tracks[0].title, "1984 / Live...");
  assert.equal(enriched.tracks[2].title, "The Finale...");
});

test("same-tier same-prefix observations expand but never shrink the selected run", async () => {
  const api = await loadTrackSelection();
  const selection = api.createTrackSelectionState();
  const short = result(api, {
    kind: api.TRACK_SOURCE_KINDS.DESCRIPTION,
    sourceId: "description",
    starts: [0, 60],
    titles: ["Opening", "Second"],
  });
  const long = result(api, {
    kind: api.TRACK_SOURCE_KINDS.DESCRIPTION,
    sourceId: "description",
    starts: [0, 60, 120, 180],
    titles: ["", "Second", "Third", "Fourth"],
  });

  consider(api, selection, short);
  const expansion = consider(api, selection, long);
  assert.equal(expansion.timingsChanged, true);
  assert.deepEqual(selection.current.tracks.map(({ start }) => start), [0, 60, 120, 180]);
  assert.equal(selection.current.tracks[0].title, "Opening");

  const shrink = consider(api, selection, short);
  assert.equal(shrink.changed, false);
  assert.equal(selection.current.tracks.length, 4);
});

test("a lower-scored comment cannot win merely by extending another comment's prefix", async () => {
  const api = await loadTrackSelection();
  const selection = api.createTrackSelectionState();
  const trustedShort = result(api, {
    kind: api.TRACK_SOURCE_KINDS.COMMENT,
    sourceId: "trusted-short",
    sourceScore: 100,
    starts: [0, 60],
  });
  const untrustedLong = result(api, {
    kind: api.TRACK_SOURCE_KINDS.COMMENT,
    sourceId: "untrusted-long",
    sourceScore: 1,
    starts: [0, 60, 120],
  });

  consider(api, selection, trustedShort);
  const change = consider(api, selection, untrustedLong);

  assert.equal(change.changed, false);
  assert.equal(selection.current.source.id, "trusted-short");
  assert.deepEqual(selection.current.tracks.map(({ start }) => start), [0, 60]);
});

test("exact-start title enrichment preserves timing provenance and playback order", async () => {
  const api = await loadTrackSelection();
  const selection = api.createTrackSelectionState();
  const description = result(api, {
    kind: api.TRACK_SOURCE_KINDS.DESCRIPTION,
    sourceId: "description",
    starts: [0, 60, 120],
    titles: ["Opening", "", "Finale..."],
  });
  const comment = result(api, {
    kind: api.TRACK_SOURCE_KINDS.COMMENT,
    sourceId: "comment",
    starts: [0, 60, 120],
    titles: ["Different opening", "Middle", "Finale"],
  });

  consider(api, selection, description);
  const enrichment = consider(api, selection, comment);

  assert.equal(selection.current.source.kind, api.TRACK_SOURCE_KINDS.DESCRIPTION);
  assert.deepEqual(selection.current.tracks.map(({ title }) => title), ["Opening", "Middle", "Finale..."]);
  assert.equal(selection.current.tracks[1].titleSource.kind, api.TRACK_SOURCE_KINDS.COMMENT);
  assert.equal(enrichment.timingsChanged, false);
  assert.equal(enrichment.titlesChanged, true);
});

test("equal-quality ties retain the incumbent across later observations", async () => {
  const api = await loadTrackSelection();
  const selection = api.createTrackSelectionState();
  const first = result(api, {
    kind: api.TRACK_SOURCE_KINDS.COMMENT,
    sourceId: "first",
    sourceScore: 42,
    titles: ["One", "Two"],
  });
  const second = result(api, {
    kind: api.TRACK_SOURCE_KINDS.COMMENT,
    sourceId: "second",
    sourceScore: 42,
    titles: ["One", "Two"],
  });

  consider(api, selection, first);
  const tie = consider(api, selection, second);

  assert.equal(selection.current.source.id, "first");
  assert.equal(tie.changed, false);
});

test("settled metadata advances without reporting a timing or title change", async () => {
  const api = await loadTrackSelection();
  const selection = api.createTrackSelectionState();
  const provisional = result(api, {
    kind: api.TRACK_SOURCE_KINDS.COMMENT,
    sourceId: "comment",
  });
  const settled = result(api, {
    kind: api.TRACK_SOURCE_KINDS.COMMENT,
    sourceId: "comment",
    status: api.TRACK_SOURCE_STATUSES.SETTLED,
  });

  consider(api, selection, provisional);
  const change = consider(api, selection, settled);

  assert.equal(selection.current.status, api.TRACK_SOURCE_STATUSES.SETTLED);
  assert.equal(change.metadataChanged, true);
  assert.equal(change.timingsChanged, false);
  assert.equal(change.titlesChanged, false);
});

test("settlement never transfers between distinct sources with matching timings", async () => {
  const api = await loadTrackSelection();
  const selection = api.createTrackSelectionState();
  const settled = result(api, {
    kind: api.TRACK_SOURCE_KINDS.COMMENT,
    sourceId: "settled-comment",
    sourceScore: 10,
    status: api.TRACK_SOURCE_STATUSES.SETTLED,
  });
  const provisional = result(api, {
    kind: api.TRACK_SOURCE_KINDS.COMMENT,
    sourceId: "provisional-comment",
    sourceScore: 20,
  });

  consider(api, selection, settled);
  consider(api, selection, provisional);

  assert.equal(selection.current.source.id, "provisional-comment");
  assert.equal(selection.current.status, api.TRACK_SOURCE_STATUSES.PROVISIONAL);
});

test("a provisional native fallback is reconsidered so it can settle", async () => {
  const api = await loadTrackSelection();
  const selection = api.createTrackSelectionState();
  const provisional = result(api, {
    kind: api.TRACK_SOURCE_KINDS.NATIVE,
    sourceId: "native",
  });
  const settled = result(api, {
    kind: api.TRACK_SOURCE_KINDS.NATIVE,
    sourceId: "native",
    status: api.TRACK_SOURCE_STATUSES.SETTLED,
  });

  assert.equal(api.shouldConsiderNativeSource(selection), true);
  consider(api, selection, provisional);
  assert.equal(api.shouldConsiderNativeSource(selection), true);
  const change = consider(api, selection, settled);

  assert.equal(selection.current.status, api.TRACK_SOURCE_STATUSES.SETTLED);
  assert.equal(change.metadataChanged, true);
  assert.equal(api.shouldConsiderNativeSource(selection), true);

  consider(api, selection, result(api, {
    kind: api.TRACK_SOURCE_KINDS.COMMENT,
    sourceId: "comment",
    titles: ["One", "Two"],
  }));
  assert.equal(api.shouldConsiderNativeSource(selection), true);
});

test("wrong videos, stale generations, and malformed timing sets are ineligible", async () => {
  const api = await loadTrackSelection();
  const selection = api.createTrackSelectionState();

  assert.equal(consider(api, selection, result(api, {
    generation: 2,
    kind: api.TRACK_SOURCE_KINDS.DESCRIPTION,
  })).accepted, false);
  assert.equal(consider(api, selection, result(api, {
    kind: api.TRACK_SOURCE_KINDS.DESCRIPTION,
    videoId: "other-video",
  })).accepted, false);

  const malformed = result(api, {
    kind: api.TRACK_SOURCE_KINDS.DESCRIPTION,
  });
  malformed.tracks[1].start = malformed.tracks[0].start;
  assert.equal(consider(api, selection, malformed).accepted, false);
  assert.equal(selection.current, null);
});

test("duration revisions invalidate old intervals and reject stale or unbounded results", async () => {
  const api = await loadTrackSelection();
  const selection = api.createTrackSelectionState();

  assert.equal(api.updateTrackSelectionDuration(selection, 90), false);
  assert.equal(selection.duration, 90);
  const short = result(api, {
    duration: 90,
    kind: api.TRACK_SOURCE_KINDS.DESCRIPTION,
    starts: [0, 30, 60],
  });
  assert.equal(consider(api, selection, short, 90).accepted, true);
  assert.equal(selection.current.tracks.at(-1).end, 90);
  const ownershipEvidence = selection.weakOwnershipObservations;
  ownershipEvidence.set("description:fixture", { count: 1 });

  assert.equal(api.updateTrackSelectionDuration(selection, 150), true);
  assert.equal(selection.duration, 150);
  assert.equal(selection.current, null, "old-duration timing decisions must be discarded");
  assert.equal(selection.weakOwnershipObservations, ownershipEvidence);
  assert.equal(selection.weakOwnershipObservations.has("description:fixture"), true);
  assert.equal(consider(api, selection, short, 150).accepted, false);

  const grown = result(api, {
    duration: 150,
    kind: api.TRACK_SOURCE_KINDS.DESCRIPTION,
    starts: [0, 30, 60, 120],
  });
  assert.equal(consider(api, selection, grown, 150).accepted, true);
  assert.equal(selection.current.tracks.at(-1).end, 150);

  const beyondDuration = result(api, {
    duration: 150,
    kind: api.TRACK_SOURCE_KINDS.DESCRIPTION,
  });
  beyondDuration.tracks.at(-1).end = 151;
  selection.current = null;
  assert.equal(consider(api, selection, beyondDuration, 150).accepted, false);

  assert.equal(api.updateTrackSelectionDuration(selection, 150), false);
  assert.equal(api.updateTrackSelectionDuration(selection, 0), false);
  assert.equal(api.updateTrackSelectionDuration(selection, Number.NaN), false);
  assert.equal(selection.duration, 150);
});

test("weak text-only ownership requires two consecutive scan observations", async () => {
  const api = await loadTrackSelection();
  const selection = api.createTrackSelectionState();
  const weakOwnership = {
    confidence: api.OWNERSHIP_CONFIDENCE.WEAK,
    evidence: "watch-shell",
  };

  const firstObservation = api.beginTrackSelectionObservation(selection);
  const first = result(api, {
    kind: api.TRACK_SOURCE_KINDS.DESCRIPTION,
    observation: firstObservation,
    ownership: weakOwnership,
  });
  assert.equal(api.observeTrackSourceOwnership(selection, first), null);
  assert.equal(api.observeTrackSourceOwnership(selection, first), null, "one scan cannot count twice");

  const secondObservation = api.beginTrackSelectionObservation(selection);
  const second = result(api, {
    kind: api.TRACK_SOURCE_KINDS.DESCRIPTION,
    observation: secondObservation,
    ownership: weakOwnership,
  });
  const confirmed = api.observeTrackSourceOwnership(selection, second);
  assert.equal(confirmed.ownership.confirmed, true);

  const thirdObservation = api.beginTrackSelectionObservation(selection);
  const changedText = result(api, {
    kind: api.TRACK_SOURCE_KINDS.DESCRIPTION,
    observation: thirdObservation,
    ownership: weakOwnership,
    titles: ["Hydrated title", "Second"],
  });
  assert.equal(api.observeTrackSourceOwnership(selection, changedText), null, "changed stale text resets confirmation");
});

test("ownership classification rejects wrong and mixed timestamp-link video ids", async () => {
  const api = await loadTrackSelection();

  assert.equal(api.classifyTrackSourceOwnership({
    linkedVideoIds: ["old-video"],
    shellVideoId: "album",
    videoId: "album",
  }), null);
  assert.equal(api.classifyTrackSourceOwnership({
    linkedVideoIds: ["album", "old-video"],
    shellVideoId: "album",
    videoId: "album",
  }), null);

  const linked = api.classifyTrackSourceOwnership({
    linkedVideoIds: ["album", "album"],
    shellVideoId: "old-video",
    videoId: "album",
  });
  assert.equal(linked.confidence, api.OWNERSHIP_CONFIDENCE.STRONG);

  const textOnly = api.classifyTrackSourceOwnership({
    linkedVideoIds: [],
    shellVideoId: "album",
    videoId: "album",
  });
  assert.equal(textOnly.confidence, api.OWNERSHIP_CONFIDENCE.WEAK);
  assert.equal(api.classifyTrackSourceOwnership({
    linkedVideoIds: [],
    shellVideoId: "old-video",
    videoId: "album",
  }), null);
  assert.equal(api.classifyTrackSourceOwnership({
    linkedVideoIds: [],
    shellVideoId: "",
    videoId: "album",
  }), null);
});

test("native ownership is bound to each candidate's link or enclosing watch shell", async () => {
  const api = await loadTrackSelection();

  assert.equal(api.classifyNativeTrackSourceOwnership([
    { linkedVideoId: "album", shellVideoId: "" },
    { linkedVideoId: "old-video", shellVideoId: "album" },
  ], "album"), null);
  assert.equal(api.classifyNativeTrackSourceOwnership([
    { linkedVideoId: "", shellVideoId: "old-video" },
    { linkedVideoId: "", shellVideoId: "old-video" },
  ], "album"), null);
  assert.equal(api.classifyNativeTrackSourceOwnership([
    { linkedVideoId: "", shellVideoId: "" },
    { linkedVideoId: "", shellVideoId: "album" },
  ], "album"), null);

  const explicit = api.classifyNativeTrackSourceOwnership([
    { linkedVideoId: "album", shellVideoId: "old-video" },
    { linkedVideoId: "album", shellVideoId: "old-video" },
  ], "album");
  assert.equal(explicit.confidence, api.OWNERSHIP_CONFIDENCE.STRONG);

  const structural = api.classifyNativeTrackSourceOwnership([
    { linkedVideoId: "album", shellVideoId: "" },
    { linkedVideoId: "", shellVideoId: "album" },
  ], "album");
  assert.equal(structural.confidence, api.OWNERSHIP_CONFIDENCE.WEAK);
});

test("missing titles permit enrichment while chapter discovery stays active", async () => {
  const api = await loadTrackSelection();
  const selection = api.createTrackSelectionState();

  consider(api, selection, result(api, {
    kind: api.TRACK_SOURCE_KINDS.DESCRIPTION,
    titles: ["Complete", ""],
  }));
  assert.equal(api.trackSourceNeedsTitleEnrichment(selection.current), true);
  assert.equal(api.shouldConsiderNativeSource(selection), true);

  consider(api, selection, result(api, {
    kind: api.TRACK_SOURCE_KINDS.COMMENT,
    sourceId: "title-donor",
    titles: ["Other", "Filled title"],
  }));
  assert.deepEqual(selection.current.tracks.map(({ title }) => title), ["Complete", "Filled title"]);
  assert.equal(api.trackSourceNeedsTitleEnrichment(selection.current), false);
  assert.equal(api.shouldConsiderNativeSource(selection), true);
});

test("separate source runs compete without being flattened into a fabricated list", async () => {
  const api = await loadTrackSelection();
  const selection = api.createTrackSelectionState();
  const firstRoot = result(api, {
    kind: api.TRACK_SOURCE_KINDS.DESCRIPTION,
    sourceId: "description-root-a",
    starts: [0, 60],
    titles: ["A", "B"],
  });
  const secondRoot = result(api, {
    kind: api.TRACK_SOURCE_KINDS.DESCRIPTION,
    sourceId: "description-root-b",
    starts: [120, 180],
    titles: ["C", "D"],
  });

  consider(api, selection, firstRoot);
  consider(api, selection, secondRoot);

  assert.equal(selection.current.source.id, "description-root-a");
  assert.deepEqual(selection.current.tracks.map(({ start }) => start), [0, 60]);
});

test("cache can enrich a live exact-start result but cannot enter selection by itself", async () => {
  const api = await loadTrackSelection();
  const selection = api.createTrackSelectionState();
  const cached = result(api, {
    generation: 7,
    kind: api.TRACK_SOURCE_KINDS.DESCRIPTION,
    sourceId: "old-description",
    titles: ["Cached one", "Cached two"],
  });
  const live = result(api, {
    kind: api.TRACK_SOURCE_KINDS.DESCRIPTION,
    sourceId: "live-description",
  });

  assert.equal(selection.current, null);
  const enriched = api.enrichTrackSourceFromCache(live, cached);
  assert.deepEqual(enriched.tracks.map(({ title }) => title), ["Cached one", "Cached two"]);
  assert.equal(selection.current, null);

  consider(api, selection, enriched);
  assert.equal(selection.current.source.id, "live-description");
});

test("title cache entries retain only immutable enrichment data", async () => {
  const api = await loadTrackSelection();
  const sourceResult = result(api, {
    generation: 9,
    kind: api.TRACK_SOURCE_KINDS.COMMENT,
    sourceId: "fetched-comment",
    status: api.TRACK_SOURCE_STATUSES.SETTLED,
    titles: ["Cached one", "Cached two"],
  });

  const entry = api.createTrackTitleCacheEntry(sourceResult);

  assert.deepEqual(Object.keys(entry).sort(), ["source", "tracks", "videoId"]);
  assert.deepEqual(
    entry.tracks.map((track) => Object.keys(track).sort()),
    [
      ["start", "title", "titleSource"],
      ["start", "title", "titleSource"],
    ]
  );
  assert.equal(entry.videoId, sourceResult.videoId);
  assert.equal(entry.source, sourceResult.source);
  assert.equal(Object.isFrozen(entry), true);
  assert.equal(Object.isFrozen(entry.tracks), true);
  assert.equal(entry.tracks.every(Object.isFrozen), true);
  assert.equal("generation" in entry, false);
  assert.equal("ownership" in entry, false);
  assert.equal("status" in entry, false);

  const live = result(api, {
    kind: api.TRACK_SOURCE_KINDS.DESCRIPTION,
    sourceId: "live-description",
  });
  const enriched = api.enrichTrackSourceFromCache(live, entry);
  assert.deepEqual(enriched.tracks.map(({ title }) => title), ["Cached one", "Cached two"]);
  assert.throws(() => api.createTrackTitleCacheEntry(null), /required for title caching/);
});

test("track selection exposes only cross-runtime operations", async () => {
  const api = await loadTrackSelection();
  for (const internalName of [
    "MINIMUM_WEAK_OWNERSHIP_OBSERVATIONS",
    "TRACK_SOURCE_TIERS",
    "getTrackSourceKey",
    "isTrackSourceEligible",
    "sameTrackStarts",
    "titleQuality",
  ]) {
    assert.equal(Object.hasOwn(api, internalName), false);
  }
});
