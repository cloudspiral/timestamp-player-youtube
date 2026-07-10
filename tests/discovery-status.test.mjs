import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadDiscoveryStatus() {
  const source = await readFile(
    new URL("../src/discovery-status.js", import.meta.url),
    "utf8"
  );
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return context.TimestampPlayerDiscoveryStatus;
}

test("creates an immutable pending discovery state", async () => {
  const {
    DISCOVERY_REASONS,
    DISCOVERY_STATUSES,
    createDiscoveryState,
  } = await loadDiscoveryStatus();

  const state = createDiscoveryState({ now: 25 });

  assert.deepEqual(
    { ...state },
    {
      changedAt: 25,
      reason: DISCOVERY_REASONS.STARTING,
      status: DISCOVERY_STATUSES.PENDING,
    }
  );
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(DISCOVERY_REASONS), true);
  assert.equal(Object.isFrozen(DISCOVERY_STATUSES), true);
});

test("transitions produce immutable snapshots and preserve no-op timestamps", async () => {
  const {
    DISCOVERY_REASONS,
    DISCOVERY_STATUSES,
    createDiscoveryState,
    transitionDiscoveryState,
  } = await loadDiscoveryStatus();
  const starting = createDiscoveryState({ now: 10 });

  const waiting = transitionDiscoveryState(
    starting,
    DISCOVERY_STATUSES.PENDING,
    DISCOVERY_REASONS.WAITING_FOR_VIDEO,
    { now: 20 }
  );
  const unchanged = transitionDiscoveryState(
    waiting.current,
    DISCOVERY_STATUSES.PENDING,
    DISCOVERY_REASONS.WAITING_FOR_VIDEO,
    { now: 30 }
  );

  assert.equal(waiting.changed, true);
  assert.equal(waiting.previous, starting);
  assert.deepEqual(
    { ...waiting.current },
    {
      changedAt: 20,
      reason: DISCOVERY_REASONS.WAITING_FOR_VIDEO,
      status: DISCOVERY_STATUSES.PENDING,
    }
  );
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.current, waiting.current);
  assert.equal(unchanged.previous, waiting.current);
  assert.equal(unchanged.current.changedAt, 20);
  assert.equal(Object.isFrozen(waiting), true);
  assert.equal(Object.isFrozen(waiting.current), true);
});

test("validates status-reason pairs, timestamps, current state, and stopped finality", async () => {
  const {
    DISCOVERY_REASONS,
    DISCOVERY_STATUSES,
    createDiscoveryState,
    transitionDiscoveryState,
    validateDiscoveryState,
  } = await loadDiscoveryStatus();
  const state = createDiscoveryState({ now: 0 });

  assert.throws(
    () => transitionDiscoveryState(
      state,
      DISCOVERY_STATUSES.READY,
      DISCOVERY_REASONS.WAITING_FOR_VIDEO
    ),
    /invalid for status/
  );
  assert.throws(
    () => transitionDiscoveryState(state, "unknown", DISCOVERY_REASONS.STARTING),
    /Unsupported discovery status/
  );
  assert.throws(
    () => transitionDiscoveryState(
      state,
      DISCOVERY_STATUSES.READY,
      DISCOVERY_REASONS.SETTLED_SOURCE,
      { now: Number.NaN }
    ),
    /timestamps/
  );
  assert.throws(
    () => validateDiscoveryState({
      changedAt: -1,
      reason: DISCOVERY_REASONS.STARTING,
      status: DISCOVERY_STATUSES.PENDING,
    }),
    /timestamps/
  );

  const stopped = transitionDiscoveryState(
    state,
    DISCOVERY_STATUSES.STOPPED,
    DISCOVERY_REASONS.SESSION_ENDED,
    { now: 5 }
  ).current;
  assert.throws(
    () => transitionDiscoveryState(
      stopped,
      DISCOVERY_STATUSES.PENDING,
      DISCOVERY_REASONS.STARTING,
      { now: 6 }
    ),
    /cannot be restarted/
  );
});

test("allows a late valid result to upgrade an empty discovery", async () => {
  const {
    DISCOVERY_REASONS,
    DISCOVERY_STATUSES,
    createDiscoveryState,
    transitionDiscoveryState,
  } = await loadDiscoveryStatus();
  const starting = createDiscoveryState({ now: 0 });
  const empty = transitionDiscoveryState(
    starting,
    DISCOVERY_STATUSES.EMPTY,
    DISCOVERY_REASONS.NO_SUPPORTED_TIMESTAMPS,
    { now: 10 }
  ).current;

  const upgraded = transitionDiscoveryState(
    empty,
    DISCOVERY_STATUSES.READY,
    DISCOVERY_REASONS.SETTLED_SOURCE,
    { now: 11 }
  );

  assert.equal(upgraded.changed, true);
  assert.equal(upgraded.current.status, DISCOVERY_STATUSES.READY);
  assert.equal(upgraded.current.reason, DISCOVERY_REASONS.SETTLED_SOURCE);
});

test("derives ready, pending, and exhausted outcomes from separable session facts", async () => {
  const {
    DISCOVERY_REASONS,
    DISCOVERY_STATUSES,
    deriveDiscoveryTarget,
  } = await loadDiscoveryStatus();

  const cases = [
    {
      facts: { hasSelectedSource: true, selectedSourceSettled: true },
      expected: [DISCOVERY_STATUSES.READY, DISCOVERY_REASONS.SETTLED_SOURCE],
    },
    {
      facts: { adPlaying: true, sourceDiscoveryExhausted: true },
      expected: [DISCOVERY_STATUSES.PENDING, DISCOVERY_REASONS.AD_PLAYING],
    },
    {
      facts: { sourceDiscoveryExhausted: true, waitingForVideoOwnership: true },
      expected: [
        DISCOVERY_STATUSES.PENDING,
        DISCOVERY_REASONS.WAITING_FOR_VIDEO_OWNERSHIP,
      ],
    },
    {
      facts: {
        adPlaying: true,
        hasSelectedSource: true,
        selectedSourceSettled: true,
      },
      expected: [DISCOVERY_STATUSES.READY, DISCOVERY_REASONS.SETTLED_SOURCE],
    },
    {
      facts: {
        hasSelectedSource: true,
        selectedSourceSettled: true,
        waitingForVideoOwnership: true,
      },
      expected: [DISCOVERY_STATUSES.READY, DISCOVERY_REASONS.SETTLED_SOURCE],
    },
    {
      facts: { hasSelectedSource: true },
      expected: [DISCOVERY_STATUSES.PENDING, DISCOVERY_REASONS.PROVISIONAL_SOURCE],
    },
    {
      facts: { descriptionDiscoveryPending: true, hasSelectedSource: true },
      expected: [DISCOVERY_STATUSES.PENDING, DISCOVERY_REASONS.PROVISIONAL_SOURCE],
    },
    {
      facts: { awaitingSourceConfirmation: true, hasSelectedSource: true },
      expected: [DISCOVERY_STATUSES.PENDING, DISCOVERY_REASONS.VERIFYING_SOURCE],
    },
    {
      facts: { hasSelectedSource: true, sourceDiscoveryExhausted: true },
      expected: [DISCOVERY_STATUSES.READY, DISCOVERY_REASONS.PROVISIONAL_SOURCE],
    },
    {
      facts: {
        commentDiscoveryPending: true,
        hasSelectedSource: true,
        sourceDiscoveryExhausted: true,
      },
      expected: [DISCOVERY_STATUSES.PENDING, DISCOVERY_REASONS.PROVISIONAL_SOURCE],
    },
    {
      facts: { commentDiscoveryPending: true, sourceDiscoveryExhausted: true },
      expected: [DISCOVERY_STATUSES.PENDING, DISCOVERY_REASONS.WAITING_FOR_COMMENT_FETCH],
    },
    {
      facts: { descriptionDiscoveryPending: true, sourceDiscoveryExhausted: true },
      expected: [DISCOVERY_STATUSES.PENDING, DISCOVERY_REASONS.WAITING_FOR_DESCRIPTION],
    },
    {
      facts: { awaitingSourceConfirmation: true },
      expected: [DISCOVERY_STATUSES.PENDING, DISCOVERY_REASONS.VERIFYING_SOURCE],
    },
    {
      facts: { awaitingSourceConfirmation: true, sourceDiscoveryExhausted: true },
      expected: [
        DISCOVERY_STATUSES.EMPTY,
        DISCOVERY_REASONS.SOURCE_OWNERSHIP_UNCONFIRMED,
      ],
    },
    {
      facts: {},
      expected: [DISCOVERY_STATUSES.PENDING, DISCOVERY_REASONS.SCANNING_SOURCES],
    },
    {
      facts: { sourceDiscoveryExhausted: true },
      expected: [DISCOVERY_STATUSES.EMPTY, DISCOVERY_REASONS.NO_SUPPORTED_TIMESTAMPS],
    },
  ];

  for (const { facts, expected: [status, reason] } of cases) {
    const target = deriveDiscoveryTarget(facts);
    assert.deepEqual({ ...target }, { reason, status });
    assert.equal(Object.isFrozen(target), true);
  }

  assert.throws(
    () => deriveDiscoveryTarget({ selectedSourceSettled: true }),
    /must also be selected/
  );
});

test("new media and ownership reasons are valid only for their intended statuses", async () => {
  const {
    DISCOVERY_REASONS,
    DISCOVERY_STATUSES,
    createDiscoveryState,
    transitionDiscoveryState,
  } = await loadDiscoveryStatus();
  const state = createDiscoveryState({ now: 0 });

  const ad = transitionDiscoveryState(
    state,
    DISCOVERY_STATUSES.PENDING,
    DISCOVERY_REASONS.AD_PLAYING,
    { now: 1 }
  ).current;
  const waitingForOwnership = transitionDiscoveryState(
    ad,
    DISCOVERY_STATUSES.PENDING,
    DISCOVERY_REASONS.WAITING_FOR_VIDEO_OWNERSHIP,
    { now: 2 }
  ).current;
  const unconfirmed = transitionDiscoveryState(
    waitingForOwnership,
    DISCOVERY_STATUSES.EMPTY,
    DISCOVERY_REASONS.SOURCE_OWNERSHIP_UNCONFIRMED,
    { now: 3 }
  ).current;

  assert.equal(ad.reason, DISCOVERY_REASONS.AD_PLAYING);
  assert.equal(waitingForOwnership.reason, DISCOVERY_REASONS.WAITING_FOR_VIDEO_OWNERSHIP);
  assert.equal(unconfirmed.status, DISCOVERY_STATUSES.EMPTY);
  assert.throws(
    () => transitionDiscoveryState(
      state,
      DISCOVERY_STATUSES.EMPTY,
      DISCOVERY_REASONS.AD_PLAYING
    ),
    /invalid for status/
  );
  assert.throws(
    () => transitionDiscoveryState(
      state,
      DISCOVERY_STATUSES.PENDING,
      DISCOVERY_REASONS.SOURCE_OWNERSHIP_UNCONFIRMED
    ),
    /invalid for status/
  );
});

test("an exhausted unconfirmed source remains eligible for a later owned upgrade", async () => {
  const {
    DISCOVERY_REASONS,
    DISCOVERY_STATUSES,
    createDiscoveryState,
    deriveDiscoveryTarget,
    transitionDiscoveryState,
  } = await loadDiscoveryStatus();
  const target = deriveDiscoveryTarget({
    awaitingSourceConfirmation: true,
    sourceDiscoveryExhausted: true,
  });
  const empty = transitionDiscoveryState(
    createDiscoveryState({ now: 0 }),
    target.status,
    target.reason,
    { now: 1 }
  ).current;
  const upgraded = transitionDiscoveryState(
    empty,
    DISCOVERY_STATUSES.READY,
    DISCOVERY_REASONS.SETTLED_SOURCE,
    { now: 2 }
  ).current;

  assert.deepEqual(
    { ...empty },
    {
      changedAt: 1,
      reason: DISCOVERY_REASONS.SOURCE_OWNERSHIP_UNCONFIRMED,
      status: DISCOVERY_STATUSES.EMPTY,
    }
  );
  assert.equal(upgraded.status, DISCOVERY_STATUSES.READY);
  assert.equal(upgraded.reason, DISCOVERY_REASONS.SETTLED_SOURCE);
});
