import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadTrackSelection() {
  const source = await readFile(new URL("../src/track-selection.js", import.meta.url), "utf8");
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return context.TimestampPlayerTrackSelection;
}

function tracks(starts, titles = []) {
  return starts.map((start, index) => ({
    index,
    start,
    end: starts[index + 1] ?? 600,
    title: titles[index] || "",
  }));
}

function result(api, {
  channel,
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
    duration: 600,
    generation,
    kind,
    observation,
    ownership,
    sourceId: sourceId || `${kind}-source`,
    sourceScore,
    status,
    tracks: tracks(starts, titles),
    videoId,
  });
}

function consider(api, selection, candidate) {
  return api.considerTrackSource(selection, candidate, {
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
  assert.deepEqual(selection.current.tracks.map(({ title }) => title), ["Opening", "Middle", "Finale"]);
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
  assert.equal(api.shouldConsiderNativeSource(selection), false);
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

test("missing or truncated titles keep lower-tier enrichment discovery active", async () => {
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
  assert.equal(api.shouldConsiderNativeSource(selection), false);
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
