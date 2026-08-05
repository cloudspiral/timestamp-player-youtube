import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadWatchSession(globals = {}) {
  const [discoveryStatusSource, timestampsSource, trackSelectionSource, source] = await Promise.all([
    readFile(new URL("../src/discovery-status.js", import.meta.url), "utf8"),
    readFile(new URL("../src/timestamps.js", import.meta.url), "utf8"),
    readFile(new URL("../src/track-selection.js", import.meta.url), "utf8"),
    readFile(new URL("../src/watch-session.js", import.meta.url), "utf8"),
  ]);
  const context = vm.createContext({ AbortController, ...globals });
  vm.runInContext(discoveryStatusSource, context);
  vm.runInContext(timestampsSource, context);
  vm.runInContext(trackSelectionSource, context);
  vm.runInContext(source, context);
  return {
    ...context.TimestampPlayerWatchSession,
    discoveryStatus: context.TimestampPlayerDiscoveryStatus,
  };
}

test("default browser timers keep the Window receiver when retries are cancelled", async () => {
  const timers = new Map();
  let nextTimerId = 1;
  const timerGlobals = {
    browserTimerGlobal: true,
    setTimeout(callback, delay) {
      if (this?.browserTimerGlobal !== true) {
        throw new TypeError("Illegal invocation");
      }
      const timerId = nextTimerId;
      nextTimerId += 1;
      timers.set(timerId, { callback, delay });
      return timerId;
    },
    clearTimeout(timerId) {
      if (this?.browserTimerGlobal !== true) {
        throw new TypeError("Illegal invocation");
      }
      timers.delete(timerId);
    },
  };
  const {
    createWatchSession,
    resetSessionRetry,
    scheduleSessionRetry,
  } = await loadWatchSession(timerGlobals);
  const session = createWatchSession({ generation: 1, videoId: "album" });

  assert.equal(scheduleSessionRetry(
    session,
    "sourceDiscovery",
    () => {},
    { now: () => 0, policy: { delays: [100], maxElapsedMs: 1000 } }
  ), true);
  assert.equal(timers.size, 1);

  assert.doesNotThrow(() => resetSessionRetry(session, "sourceDiscovery"));
  assert.equal(timers.size, 0);
});

class FakeClock {
  now = 0;
  nextTimerId = 1;
  timers = new Map();

  setTimeout = (callback, delay) => {
    const timerId = this.nextTimerId;
    this.nextTimerId += 1;
    this.timers.set(timerId, {
      callback,
      dueAt: this.now + delay,
    });
    return timerId;
  };

  clearTimeout = (timerId) => {
    this.timers.delete(timerId);
  };

  advance(milliseconds) {
    const targetTime = this.now + milliseconds;
    while (true) {
      const nextTimer = [...this.timers.entries()]
        .filter(([, timer]) => timer.dueAt <= targetTime)
        .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
      if (!nextTimer) {
        break;
      }

      const [timerId, timer] = nextTimer;
      this.timers.delete(timerId);
      this.now = timer.dueAt;
      timer.callback();
    }
    this.now = targetTime;
  }

  dependencies() {
    return {
      clearTimer: this.clearTimeout,
      now: () => this.now,
      setTimer: this.setTimeout,
    };
  }
}

test("creates an isolated pending discovery state instead of a write-only phase", async () => {
  const {
    createWatchSession,
    discoveryStatus: { DISCOVERY_REASONS, DISCOVERY_STATUSES },
  } = await loadWatchSession();
  const session = createWatchSession({
    generation: 1,
    now: 123,
    videoId: "album",
  });

  assert.equal(Object.hasOwn(session, "phase"), false);
  assert.equal(session.discovery.status, DISCOVERY_STATUSES.PENDING);
  assert.equal(session.discovery.reason, DISCOVERY_REASONS.STARTING);
  assert.equal(session.discovery.changedAt, 123);
  assert.equal(Object.isFrozen(session.discovery), true);
  assert.deepEqual(Array.from(session.commentDiscovery.seeds), []);
  assert.equal(session.commentDiscovery.resultDuration, null);
  assert.equal(session.commentDiscovery.resultSeeds, null);
  assert.equal(session.commentDiscovery.resultStatus, null);
});

test("disposal stops discovery before abort and keeps the first stop final", async () => {
  const {
    createWatchSession,
    discoveryStatus: {
      DISCOVERY_REASONS,
      DISCOVERY_STATUSES,
      transitionDiscoveryState,
    },
    disposeWatchSession,
  } = await loadWatchSession();
  const session = createWatchSession({ generation: 1, now: 10, videoId: "album" });
  let discoveryAtAbort = null;
  session.abortController.signal.addEventListener("abort", () => {
    discoveryAtAbort = session.discovery;
  });

  const transition = disposeWatchSession(session, "video-changed", { now: 75 });

  assert.equal(transition.changed, true);
  assert.equal(transition.current, session.discovery);
  assert.equal(session.discovery.status, DISCOVERY_STATUSES.STOPPED);
  assert.equal(session.discovery.reason, DISCOVERY_REASONS.SESSION_ENDED);
  assert.equal(session.discovery.changedAt, 75);
  assert.equal(discoveryAtAbort, session.discovery, "stop state must be visible to abort listeners");
  assert.equal(session.abortController.signal.aborted, true);
  assert.equal(session.abortController.signal.reason, "video-changed");

  const firstStoppedState = session.discovery;
  assert.equal(
    disposeWatchSession(session, "duplicate-dispose", { now: 100 }),
    null
  );
  assert.equal(session.discovery, firstStoppedState);
  assert.equal(session.discovery.changedAt, 75);
  assert.throws(() => transitionDiscoveryState(
    session.discovery,
    DISCOVERY_STATUSES.PENDING,
    DISCOVERY_REASONS.STARTING,
    { now: 100 }
  ), /cannot be restarted/i);
});

test("a disposed generation aborts and cannot run queued work after navigation", async () => {
  const {
    createWatchSession,
    discoveryStatus: { DISCOVERY_STATUSES },
    disposeWatchSession,
    isWatchSessionCurrent,
    scheduleSessionTask,
  } = await loadWatchSession();
  const clock = new FakeClock();
  const sessionA = createWatchSession({ generation: 1, videoId: "video-a", now: clock.now });
  const sessionB = createWatchSession({ generation: 2, videoId: "video-b", now: clock.now });
  let staleRuns = 0;

  scheduleSessionTask(sessionA, "scan", () => {
    staleRuns += 1;
  }, { delay: 100, ...clock.dependencies() });

  assert.equal(isWatchSessionCurrent(sessionA, {
    activeSession: sessionA,
    activeVideoId: "video-a",
    watchPageActive: true,
  }), true);

  disposeWatchSession(sessionA, "video-changed");
  clock.advance(100);

  assert.equal(sessionA.abortController.signal.aborted, true);
  assert.equal(sessionA.discovery.status, DISCOVERY_STATUSES.STOPPED);
  assert.equal(staleRuns, 0);
  assert.equal(clock.timers.size, 0);
  assert.equal(isWatchSessionCurrent(sessionA, {
    activeSession: sessionB,
    activeVideoId: "video-b",
    watchPageActive: true,
  }), false);
});

test("current-session checks reject wrong videos, inactive routes, and aborted work", async () => {
  const {
    createWatchSession,
    disposeWatchSession,
    isWatchSessionCurrent,
  } = await loadWatchSession();
  const session = createWatchSession({ generation: 4, videoId: "album" });

  assert.equal(isWatchSessionCurrent(session, {
    activeSession: session,
    activeVideoId: "different-video",
    watchPageActive: true,
  }), false);
  assert.equal(isWatchSessionCurrent(session, {
    activeSession: session,
    activeVideoId: "album",
    watchPageActive: false,
  }), false);

  disposeWatchSession(session);
  assert.equal(isWatchSessionCurrent(session, {
    activeSession: session,
    activeVideoId: "album",
    watchPageActive: true,
  }), false);
});

test("each watch session starts with isolated empty media ownership", async () => {
  const { createWatchSession } = await loadWatchSession();
  const session = createWatchSession({ generation: 1, videoId: "album" });
  const nextSession = createWatchSession({ generation: 2, videoId: "next-album" });

  assert.notEqual(session.media, nextSession.media);
  assert.deepEqual(
    {
      binding: session.media.binding,
      closed: session.media.closed,
      element: session.media.element,
      ended: session.media.ended,
      releaseListeners: session.media.releaseListeners,
      resolution: session.media.resolution,
      revision: session.media.revision,
      seeking: session.media.seeking,
    },
    {
      binding: null,
      closed: false,
      element: null,
      ended: false,
      releaseListeners: null,
      resolution: null,
      revision: 0,
      seeking: false,
    }
  );
});

test("replacing media releases the old listeners once and stale bindings cannot clear the current element", async () => {
  const {
    bindSessionMedia,
    clearSessionMedia,
    createWatchSession,
    disposeWatchSession,
    isSessionMediaCurrent,
  } = await loadWatchSession();
  const session = createWatchSession({ generation: 1, videoId: "album" });
  const firstElement = { id: "first" };
  const secondElement = { id: "second" };
  const releases = [];
  const releaseFirst = () => releases.push("first");
  const releaseSecond = () => releases.push("second");

  const firstBinding = bindSessionMedia(session, firstElement, releaseFirst);
  session.media.resolution = { reason: "current-watch-player", status: "ready" };
  assert.equal(Object.isFrozen(firstBinding), true);
  assert.equal(isSessionMediaCurrent(session, firstBinding), true);
  assert.equal(
    bindSessionMedia(session, firstElement, releaseFirst),
    firstBinding,
    "rebinding the exact listener set is a no-op"
  );
  assert.deepEqual(
    session.media.resolution,
    { reason: "current-watch-player", status: "ready" },
    "an exact same-element listener binding preserves its updated resolver snapshot"
  );
  assert.deepEqual(releases, []);

  session.media.ended = true;
  session.media.seeking = true;
  const secondBinding = bindSessionMedia(session, secondElement, releaseSecond);
  assert.deepEqual(releases, ["first"]);
  assert.equal(session.media.element, secondElement);
  assert.equal(session.media.ended, false);
  assert.equal(session.media.resolution, null);
  assert.equal(session.media.revision, 2);
  assert.equal(session.media.seeking, false);
  assert.equal(isSessionMediaCurrent(session, firstBinding), false);
  assert.equal(isSessionMediaCurrent(session, secondBinding), true);

  assert.equal(clearSessionMedia(session, firstBinding), false);
  assert.deepEqual(releases, ["first"], "a stale binding cannot release current listeners");
  session.media.resolution = { reason: "current-watch-player", status: "ready" };
  assert.equal(clearSessionMedia(session, secondBinding), true);
  assert.deepEqual(releases, ["first", "second"]);
  assert.equal(session.media.ended, false);
  assert.equal(session.media.resolution, null);
  assert.equal(session.media.seeking, false);
  assert.equal(clearSessionMedia(session, secondBinding), false);
  assert.deepEqual(releases, ["first", "second"]);
  disposeWatchSession(session);
  assert.deepEqual(releases, ["first", "second"], "disposal cannot double-release a cleared binding");
});

test("rebinding the same element replaces its listener generation and disposal releases only the latest one", async () => {
  const {
    bindSessionMedia,
    clearSessionMedia,
    createWatchSession,
    disposeWatchSession,
    isSessionMediaCurrent,
  } = await loadWatchSession();
  const session = createWatchSession({ generation: 1, videoId: "album" });
  const element = { id: "video" };
  const releases = [];
  const firstBinding = bindSessionMedia(session, element, () => releases.push("first"));
  session.media.resolution = { reason: "video-duration-unavailable", status: "waiting" };
  session.media.ended = true;
  session.media.seeking = true;
  const secondBinding = bindSessionMedia(session, element, () => releases.push("second"));

  assert.deepEqual(releases, ["first"]);
  assert.equal(session.media.ended, false);
  assert.notEqual(secondBinding, firstBinding);
  assert.equal(session.media.resolution, null);
  assert.equal(session.media.seeking, false);
  assert.equal(secondBinding.revision, firstBinding.revision + 1);
  assert.equal(isSessionMediaCurrent(session, firstBinding), false);
  assert.equal(isSessionMediaCurrent(session, secondBinding), true);
  assert.equal(clearSessionMedia(session, firstBinding), false);
  session.media.resolution = { reason: "current-watch-player", status: "ready" };

  disposeWatchSession(session, "video-changed");
  disposeWatchSession(session, "duplicate-dispose");

  assert.deepEqual(releases, ["first", "second"]);
  assert.equal(session.media.binding, null);
  assert.equal(session.media.element, null);
  assert.equal(session.media.releaseListeners, null);
  assert.equal(session.media.resolution, null);
  assert.equal(session.media.closed, true);
  assert.equal(session.media.ended, false);
  assert.equal(session.media.seeking, false);
});

test("disposal closes media before teardown so reentrant and late stale bindings release immediately", async () => {
  const {
    bindSessionMedia,
    createWatchSession,
    disposeWatchSession,
  } = await loadWatchSession();
  const session = createWatchSession({ generation: 1, videoId: "album" });
  const events = [];
  let reentrantBinding = "not-called";
  bindSessionMedia(session, { id: "current" }, () => {
    events.push("release-current");
    reentrantBinding = bindSessionMedia(session, { id: "reentrant" }, () => {
      events.push("release-reentrant");
    });
  });
  session.abortController.signal.addEventListener("abort", () => {
    events.push("abort");
  });

  disposeWatchSession(session, "video-changed");

  assert.equal(reentrantBinding, null);
  assert.deepEqual(events, ["release-current", "release-reentrant", "abort"]);
  assert.equal(session.media.binding, null);
  assert.equal(session.media.resolution, null);
  assert.equal(session.media.closed, true);

  const lateBinding = bindSessionMedia(session, { id: "late" }, () => {
    events.push("release-late");
  });
  assert.equal(lateBinding, null);
  assert.deepEqual(events, [
    "release-current",
    "release-reentrant",
    "abort",
    "release-late",
  ]);
});

test("listener release failures cannot block replacement or session abort", async () => {
  const {
    bindSessionMedia,
    createWatchSession,
    disposeWatchSession,
    isSessionMediaCurrent,
  } = await loadWatchSession();
  const session = createWatchSession({ generation: 1, videoId: "album" });
  bindSessionMedia(session, { id: "throwing" }, () => {
    throw new Error("listener teardown failed");
  });

  const replacement = bindSessionMedia(session, { id: "replacement" });
  assert.equal(isSessionMediaCurrent(session, replacement), true);
  assert.doesNotThrow(() => disposeWatchSession(session));
  assert.equal(session.abortController.signal.aborted, true);
  assert.equal(session.media.binding, null);
});

test("scheduled work coalesces without letting a later request postpone an earlier one", async () => {
  const {
    createWatchSession,
    scheduleSessionTask,
  } = await loadWatchSession();
  const clock = new FakeClock();
  const session = createWatchSession({ generation: 1, videoId: "album", now: clock.now });
  const runs = [];

  assert.equal(scheduleSessionTask(session, "scan", () => runs.push("late"), {
    delay: 500,
    ...clock.dependencies(),
  }), true);
  assert.equal(scheduleSessionTask(session, "scan", () => runs.push("early"), {
    delay: 100,
    ...clock.dependencies(),
  }), true);
  assert.equal(scheduleSessionTask(session, "scan", () => runs.push("postponed"), {
    delay: 300,
    ...clock.dependencies(),
  }), false);

  assert.equal(clock.timers.size, 1);
  clock.advance(100);
  assert.deepEqual(runs, ["early"]);
});

test("source discovery retries are bounded and repeated requests do not consume attempts", async () => {
  const {
    createWatchSession,
    scheduleSessionRetry,
  } = await loadWatchSession();
  const clock = new FakeClock();
  const session = createWatchSession({ generation: 1, videoId: "album", now: clock.now });
  const policy = { delays: [10, 20], maxElapsedMs: 100 };
  let retryRuns = 0;

  assert.equal(scheduleSessionRetry(session, "sourceDiscovery", () => {
    retryRuns += 1;
  }, { policy, ...clock.dependencies() }), true);
  assert.equal(scheduleSessionRetry(session, "sourceDiscovery", () => {
    retryRuns += 1;
  }, { policy, ...clock.dependencies() }), false);
  assert.equal(session.retries.sourceDiscovery.attempt, 1);

  clock.advance(10);
  assert.equal(retryRuns, 1);
  assert.equal(scheduleSessionRetry(session, "sourceDiscovery", () => {
    retryRuns += 1;
  }, { policy, ...clock.dependencies() }), true);
  assert.equal(scheduleSessionRetry(session, "sourceDiscovery", () => {
    retryRuns += 1;
  }, { policy, ...clock.dependencies() }), false);
  assert.equal(session.retries.sourceDiscovery.exhausted, false);
  assert.equal(clock.timers.size, 1);
  clock.advance(20);
  assert.equal(retryRuns, 2);

  assert.equal(scheduleSessionRetry(session, "sourceDiscovery", () => {
    retryRuns += 1;
  }, { policy, ...clock.dependencies() }), false);
  assert.equal(session.retries.sourceDiscovery.exhausted, true);
  assert.equal(clock.timers.size, 0);
});

test("media, source, and launcher retries are independent", async () => {
  const {
    DEFAULT_RETRY_POLICIES,
    createWatchSession,
    disposeWatchSession,
    resetSessionRetry,
    scheduleSessionRetry,
  } = await loadWatchSession();
  const clock = new FakeClock();
  const session = createWatchSession({ generation: 1, videoId: "album", now: clock.now });
  const policy = { delays: [10, 20], maxElapsedMs: 100 };

  assert.deepEqual(
    Array.from(DEFAULT_RETRY_POLICIES.mediaReadiness.delays),
    [100, 250, 500, 1000, 2000, 3000]
  );
  assert.deepEqual(
    Array.from(DEFAULT_RETRY_POLICIES.sourceDiscovery.delays),
    [100, 250, 500, 1000, 2000, 3000]
  );
  assert.equal(Object.hasOwn(DEFAULT_RETRY_POLICIES, "readiness"), false);

  scheduleSessionRetry(session, "mediaReadiness", () => {}, { policy, ...clock.dependencies() });
  scheduleSessionRetry(session, "sourceDiscovery", () => {}, { policy, ...clock.dependencies() });
  scheduleSessionRetry(session, "launcher", () => {}, { policy, ...clock.dependencies() });
  assert.equal(clock.timers.size, 3);
  assert.equal(session.retries.mediaReadiness.attempt, 1);
  assert.equal(session.retries.sourceDiscovery.attempt, 1);
  assert.equal(session.retries.launcher.attempt, 1);

  resetSessionRetry(session, "launcher");
  assert.equal(clock.timers.size, 2);
  assert.equal(session.retries.mediaReadiness.attempt, 1);
  assert.equal(session.retries.sourceDiscovery.attempt, 1);
  assert.equal(session.retries.launcher.attempt, 0);
  assert.equal(session.retries.launcher.exhausted, false);

  disposeWatchSession(session);
  assert.equal(clock.timers.size, 0);
});

test("resetting source discovery after a media outage grants a fresh search budget", async () => {
  const {
    createWatchSession,
    resetSessionRetry,
    scheduleSessionRetry,
  } = await loadWatchSession();
  const clock = new FakeClock();
  const session = createWatchSession({ generation: 1, videoId: "album", now: clock.now });
  const policy = { delays: [100], maxElapsedMs: 1000 };

  assert.equal(scheduleSessionRetry(
    session,
    "sourceDiscovery",
    () => {},
    { policy, ...clock.dependencies() }
  ), true);
  clock.advance(15100);
  assert.equal(scheduleSessionRetry(
    session,
    "sourceDiscovery",
    () => {},
    { policy, ...clock.dependencies() }
  ), false);
  assert.equal(session.retries.sourceDiscovery.exhausted, true);

  resetSessionRetry(session, "sourceDiscovery");

  assert.equal(session.retries.sourceDiscovery.startedAt, null);
  assert.equal(session.retries.sourceDiscovery.exhausted, false);
  assert.equal(scheduleSessionRetry(
    session,
    "sourceDiscovery",
    () => {},
    { policy, ...clock.dependencies() }
  ), true);
  assert.equal(session.retries.sourceDiscovery.startedAt, clock.now);
  assert.equal(session.retries.sourceDiscovery.attempt, 1);
});

test("resetting for description expansion cancels old work and restores a full retry budget", async () => {
  const {
    createWatchSession,
    resetSessionRetry,
    scheduleSessionRetry,
  } = await loadWatchSession();
  const clock = new FakeClock();
  const session = createWatchSession({ generation: 1, videoId: "album", now: clock.now });
  const policy = { delays: [10, 20], maxElapsedMs: 100 };
  const runs = [];

  assert.equal(scheduleSessionRetry(
    session,
    "sourceDiscovery",
    () => runs.push("old"),
    { policy, ...clock.dependencies() }
  ), true);
  resetSessionRetry(session, "sourceDiscovery");
  assert.equal(clock.timers.size, 0, "the pre-expansion retry must be cancelled");

  assert.equal(scheduleSessionRetry(
    session,
    "sourceDiscovery",
    () => runs.push("first"),
    { policy, ...clock.dependencies() }
  ), true);
  clock.advance(10);
  assert.equal(scheduleSessionRetry(
    session,
    "sourceDiscovery",
    () => runs.push("second"),
    { policy, ...clock.dependencies() }
  ), true);
  clock.advance(20);

  assert.deepEqual(runs, ["first", "second"]);
  assert.equal(session.retries.sourceDiscovery.attempt, 2);
  assert.equal(session.retries.sourceDiscovery.exhausted, false);
});

test("comment discovery retries once and is cancelled with its watch generation", async () => {
  const {
    DEFAULT_RETRY_POLICIES,
    createWatchSession,
    disposeWatchSession,
    scheduleSessionRetry,
  } = await loadWatchSession();
  const clock = new FakeClock();
  const session = createWatchSession({ generation: 1, videoId: "album", now: clock.now });
  const runs = [];

  assert.deepEqual(Array.from(DEFAULT_RETRY_POLICIES.commentFetch.delays), [1000]);
  assert.equal(scheduleSessionRetry(session, "commentFetch", () => {
    runs.push("retry");
  }, clock.dependencies()), true);
  assert.equal(scheduleSessionRetry(session, "commentFetch", () => {
    runs.push("duplicate");
  }, clock.dependencies()), false);

  clock.advance(1000);
  assert.deepEqual(runs, ["retry"]);
  assert.equal(scheduleSessionRetry(session, "commentFetch", () => {
    runs.push("second-retry");
  }, clock.dependencies()), false);
  assert.equal(session.retries.commentFetch.exhausted, true);

  const cancelledSession = createWatchSession({ generation: 2, videoId: "next-album", now: clock.now });
  scheduleSessionRetry(cancelledSession, "commentFetch", () => {
    runs.push("stale-retry");
  }, clock.dependencies());
  disposeWatchSession(cancelledSession, "video-changed");
  clock.advance(1000);

  assert.deepEqual(runs, ["retry"]);
  assert.equal(clock.timers.size, 0);
});

test("each session owns isolated provenance selection and comment discovery state", async () => {
  const {
    COMMENT_DISCOVERY_STATUSES,
    createWatchSession,
    discoveryStatus: { DISCOVERY_REASONS, DISCOVERY_STATUSES },
  } = await loadWatchSession();
  const session = createWatchSession({ generation: 1, now: 50, videoId: "album" });
  const nextSession = createWatchSession({ generation: 2, now: 50, videoId: "next-album" });

  assert.equal(session.discovery.status, DISCOVERY_STATUSES.PENDING);
  assert.equal(session.discovery.reason, DISCOVERY_REASONS.STARTING);
  assert.notEqual(session.discovery, nextSession.discovery);
  assert.equal(session.commentDiscovery.attempt, 0);
  assert.equal(session.commentDiscovery.attemptStartedAt, null);
  assert.equal(session.commentDiscovery.status, COMMENT_DISCOVERY_STATUSES.IDLE);
  assert.equal(session.commentDiscovery.result, null);
  assert.notEqual(session.commentDiscovery, nextSession.commentDiscovery);
  assert.equal(session.trackSelection.current, null);
  assert.notEqual(session.trackSelection, nextSession.trackSelection);
  assert.notEqual(session.domSources.ids, nextSession.domSources.ids);
});

test("manifest loads the watch-session runtime before content orchestration", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const scripts = manifest.content_scripts[0].js;

  assert.ok(scripts.includes("src/watch-session.js"));
  assert.ok(scripts.includes("src/track-selection.js"));
  assert.ok(
    scripts.indexOf("src/watch-route.js") < scripts.indexOf("src/watch-session.js"),
    "route detection should load before session ownership"
  );
  assert.ok(
    scripts.indexOf("src/track-selection.js") < scripts.indexOf("src/watch-session.js"),
    "track selection must load before session ownership"
  );
  assert.ok(
    scripts.indexOf("src/watch-session.js") < scripts.indexOf("src/content.js"),
    "session ownership must load before content orchestration"
  );
});
