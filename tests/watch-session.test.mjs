import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadWatchSession() {
  const source = await readFile(new URL("../src/watch-session.js", import.meta.url), "utf8");
  const context = vm.createContext({ AbortController });
  vm.runInContext(source, context);
  return context.TimestampPlayerWatchSession;
}

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

test("a disposed generation aborts and cannot run queued work after navigation", async () => {
  const {
    createWatchSession,
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
  assert.equal(sessionA.phase, "stopped");
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

test("readiness retries are bounded and repeated requests do not consume attempts", async () => {
  const {
    createWatchSession,
    scheduleSessionRetry,
  } = await loadWatchSession();
  const clock = new FakeClock();
  const session = createWatchSession({ generation: 1, videoId: "album", now: clock.now });
  const policy = { delays: [10, 20], maxElapsedMs: 100 };
  let retryRuns = 0;

  assert.equal(scheduleSessionRetry(session, "readiness", () => {
    retryRuns += 1;
  }, { policy, ...clock.dependencies() }), true);
  assert.equal(scheduleSessionRetry(session, "readiness", () => {
    retryRuns += 1;
  }, { policy, ...clock.dependencies() }), false);
  assert.equal(session.retries.readiness.attempt, 1);

  clock.advance(10);
  assert.equal(retryRuns, 1);
  assert.equal(scheduleSessionRetry(session, "readiness", () => {
    retryRuns += 1;
  }, { policy, ...clock.dependencies() }), true);
  assert.equal(scheduleSessionRetry(session, "readiness", () => {
    retryRuns += 1;
  }, { policy, ...clock.dependencies() }), false);
  assert.equal(session.retries.readiness.exhausted, false);
  assert.equal(clock.timers.size, 1);
  clock.advance(20);
  assert.equal(retryRuns, 2);

  assert.equal(scheduleSessionRetry(session, "readiness", () => {
    retryRuns += 1;
  }, { policy, ...clock.dependencies() }), false);
  assert.equal(session.retries.readiness.exhausted, true);
  assert.equal(clock.timers.size, 0);
});

test("launcher retries are independent and can be reset without disturbing readiness", async () => {
  const {
    createWatchSession,
    disposeWatchSession,
    resetSessionRetry,
    scheduleSessionRetry,
  } = await loadWatchSession();
  const clock = new FakeClock();
  const session = createWatchSession({ generation: 1, videoId: "album", now: clock.now });
  const policy = { delays: [10, 20], maxElapsedMs: 100 };

  scheduleSessionRetry(session, "readiness", () => {}, { policy, ...clock.dependencies() });
  scheduleSessionRetry(session, "launcher", () => {}, { policy, ...clock.dependencies() });
  assert.equal(clock.timers.size, 2);
  assert.equal(session.retries.readiness.attempt, 1);
  assert.equal(session.retries.launcher.attempt, 1);

  resetSessionRetry(session, "launcher");
  assert.equal(clock.timers.size, 1);
  assert.equal(session.retries.readiness.attempt, 1);
  assert.equal(session.retries.launcher.attempt, 0);
  assert.equal(session.retries.launcher.exhausted, false);

  disposeWatchSession(session);
  assert.equal(clock.timers.size, 0);
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

test("comment and native tracks stay provisional until session comment discovery settles", async () => {
  const {
    COMMENT_DISCOVERY_STATUSES,
    createWatchSession,
    shouldLockSessionTracks,
  } = await loadWatchSession();
  const session = createWatchSession({ generation: 1, videoId: "album" });
  const nextSession = createWatchSession({ generation: 2, videoId: "next-album" });

  assert.equal(session.commentDiscovery.status, COMMENT_DISCOVERY_STATUSES.IDLE);
  assert.notEqual(session.commentDiscovery, nextSession.commentDiscovery);
  assert.equal(shouldLockSessionTracks(session), false);
  assert.equal(shouldLockSessionTracks(session, { descriptionTracksFound: true }), true);

  session.commentDiscovery.status = COMMENT_DISCOVERY_STATUSES.PENDING;
  assert.equal(shouldLockSessionTracks(session), false);
  session.commentDiscovery.status = COMMENT_DISCOVERY_STATUSES.RETRY_WAIT;
  assert.equal(shouldLockSessionTracks(session), false);
  session.commentDiscovery.status = COMMENT_DISCOVERY_STATUSES.DONE;
  assert.equal(shouldLockSessionTracks(session), true);
});

test("manifest loads the watch-session runtime before content orchestration", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const scripts = manifest.content_scripts[0].js;

  assert.ok(scripts.includes("src/watch-session.js"));
  assert.ok(
    scripts.indexOf("src/watch-route.js") < scripts.indexOf("src/watch-session.js"),
    "route detection should load before session ownership"
  );
  assert.ok(
    scripts.indexOf("src/watch-session.js") < scripts.indexOf("src/content.js"),
    "session ownership must load before content orchestration"
  );
});
