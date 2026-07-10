import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadRuntime() {
  const [discoveryStatusSource, sessionSource, mutationSource] = await Promise.all([
    readFile(new URL("../src/discovery-status.js", import.meta.url), "utf8"),
    readFile(new URL("../src/watch-session.js", import.meta.url), "utf8"),
    readFile(new URL("../src/watch-mutations.js", import.meta.url), "utf8"),
  ]);
  const context = vm.createContext({
    AbortController,
    TimestampPlayerTrackSelection: {
      createTrackSelectionState: () => ({}),
    },
  });
  vm.runInContext(discoveryStatusSource, context);
  vm.runInContext(sessionSource, context);
  vm.runInContext(mutationSource, context);
  return {
    mutations: context.TimestampPlayerWatchMutations,
    sessions: context.TimestampPlayerWatchSession,
  };
}

class FakeNode {
  constructor(...selectors) {
    this.nodeType = 1;
    this.parentElement = null;
    this.children = [];
    this.selectors = new Set(selectors);
  }

  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  matches(selector) {
    return this.selectors.has(selector);
  }

  closest(selector) {
    for (let current = this; current; current = current.parentElement) {
      if (current.matches(selector)) {
        return current;
      }
    }
    return null;
  }

  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches(selector)) {
        return child;
      }
      const nested = child.querySelector(selector);
      if (nested) {
        return nested;
      }
    }
    return null;
  }
}

class FakeClock {
  now = 0;
  nextTimerId = 1;
  timers = new Map();

  setTimeout = (callback, delay) => {
    const id = this.nextTimerId;
    this.nextTimerId += 1;
    this.timers.set(id, { callback, dueAt: this.now + delay });
    return id;
  };

  clearTimeout = (id) => {
    this.timers.delete(id);
  };

  advance(milliseconds) {
    const target = this.now + milliseconds;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.dueAt <= target)
        .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
      if (!next) {
        break;
      }
      const [id, timer] = next;
      this.timers.delete(id);
      this.now = timer.dueAt;
      timer.callback();
    }
    this.now = target;
  }

  dependencies() {
    return {
      clearTimer: this.clearTimeout,
      now: () => this.now,
      setTimer: this.setTimeout,
    };
  }
}

function mutation(target, { addedNodes = [], removedNodes = [] } = {}) {
  return { addedNodes, removedNodes, target };
}

test("unrelated YouTube mutation storms do not request discovery or launcher work", async () => {
  const { mutations } = await loadRuntime();
  let discoverySchedules = 0;
  let launcherSchedules = 0;

  for (let index = 0; index < 1000; index += 1) {
    mutations.dispatchWatchMutations([
      mutation(new FakeNode("ytd-rich-item-renderer")),
    ], {
      onDiscovery: () => {
        discoverySchedules += 1;
      },
      onLauncher: () => {
        launcherSchedules += 1;
      },
    });
  }

  assert.equal(discoverySchedules, 0);
  assert.equal(launcherSchedules, 0);
});

test("relevant mutation storms coalesce through the generation-scoped scan task", async () => {
  const { mutations, sessions } = await loadRuntime();
  const clock = new FakeClock();
  const session = sessions.createWatchSession({ generation: 1, videoId: "album", now: 0 });
  const comment = new FakeNode("ytd-comment-thread-renderer");
  let scans = 0;

  for (let index = 0; index < 100; index += 1) {
    mutations.dispatchWatchMutations([mutation(comment)], {
      onDiscovery: () => sessions.scheduleSessionTask(session, "scan", () => {
        scans += 1;
      }, { delay: 600, ...clock.dependencies() }),
    });
  }

  assert.equal(clock.timers.size, 1);
  clock.advance(599);
  assert.equal(scans, 0);
  clock.advance(1);
  assert.equal(scans, 1);
});

test("action row changes route to launcher sync without full discovery", async () => {
  const { mutations } = await loadRuntime();
  const actionRow = new FakeNode("#top-level-buttons-computed");
  const ordinaryButton = new FakeNode("button");
  const extensionButton = new FakeNode("#timestamp-player-launcher");
  let scans = 0;
  let launcherSyncs = 0;

  const result = mutations.dispatchWatchMutations([
    mutation(actionRow, { addedNodes: [ordinaryButton] }),
  ], {
    onDiscovery: () => {
      scans += 1;
    },
    onLauncher: () => {
      launcherSyncs += 1;
    },
  });
  mutations.dispatchWatchMutations([
    mutation(actionRow, { addedNodes: [extensionButton] }),
  ], {
    isExtensionNode: (node) => node === extensionButton,
    onDiscovery: () => {
      scans += 1;
    },
    onLauncher: () => {
      launcherSyncs += 1;
    },
  });

  assert.equal(result.discovery, false);
  assert.equal(result.launcher, true);
  assert.equal(scans, 0);
  assert.equal(launcherSyncs, 1, "inserting the extension launcher must not loop");
});

test("removing an extension launcher from YouTube's action row schedules recovery", async () => {
  const { mutations } = await loadRuntime();
  const actionRow = new FakeNode("#top-level-buttons-computed");
  const extensionButton = new FakeNode("#timestamp-player-launcher");
  let launcherSyncs = 0;

  const result = mutations.dispatchWatchMutations([
    mutation(actionRow, { removedNodes: [extensionButton] }),
  ], {
    isExtensionNode: (node) => node === extensionButton,
    onLauncher: () => {
      launcherSyncs += 1;
    },
  });

  assert.equal(result.launcher, true);
  assert.equal(launcherSyncs, 1);
});

test("settled source interests preserve higher-tier and title upgrades", async () => {
  const { mutations } = await loadRuntime();
  const domains = mutations.WATCH_MUTATION_DOMAINS;

  const completeDescription = mutations.getTrackMutationInterests({
    settled: true,
    sourceKind: "description",
  });
  assert.equal(completeDescription[domains.DESCRIPTION], true);
  assert.equal(completeDescription[domains.COMMENTS], false);
  assert.equal(completeDescription[domains.NATIVE], false);
  assert.equal(completeDescription[domains.PLAYER], true);

  const incompleteDescription = mutations.getTrackMutationInterests({
    needsTitleEnrichment: true,
    settled: true,
    sourceKind: "description",
  });
  assert.equal(incompleteDescription[domains.COMMENTS], true);
  assert.equal(incompleteDescription[domains.NATIVE], true);

  const completeComment = mutations.getTrackMutationInterests({
    settled: true,
    sourceKind: "comment",
  });
  assert.equal(completeComment[domains.DESCRIPTION], true, "higher-tier descriptions remain observable");
  assert.equal(completeComment[domains.COMMENTS], true, "same-tier comment upgrades remain observable");
  assert.equal(completeComment[domains.NATIVE], false);
});

test("new relevant roots are detected without treating their unrelated parent as relevant", async () => {
  const { mutations } = await loadRuntime();
  const body = new FakeNode("body");
  const wrapper = new FakeNode("div");
  wrapper.append(new FakeNode("#description-inline-expander"));

  const result = mutations.classifyWatchMutations([
    mutation(body, { addedNodes: [wrapper] }),
  ]);
  const unrelated = mutations.classifyWatchMutations([
    mutation(body, { addedNodes: [new FakeNode("ytd-rich-grid-renderer")] }),
  ]);

  assert.equal(result.discovery, true);
  assert.equal(unrelated.discovery, false);
});

test("late text and watch-shell hydration route discovery and media work independently", async () => {
  const { mutations } = await loadRuntime();
  const description = new FakeNode("#description-inline-expander");
  const textNode = { nodeType: 3, parentElement: description };
  const watchShell = new FakeNode("ytd-watch-flexy");
  const unrelatedChild = new FakeNode("ytd-rich-item-renderer");
  watchShell.append(unrelatedChild);

  assert.equal(mutations.classifyWatchMutations([mutation(textNode)]).discovery, true);
  const watchShellMutation = mutations.classifyWatchMutations([mutation(watchShell)]);
  assert.equal(watchShellMutation.discovery, false);
  assert.equal(watchShellMutation.media, true);
  assert.equal(
    mutations.classifyWatchMutations([mutation(unrelatedChild)]).media,
    false,
    "watch-shell descendants must not all become player mutations"
  );

  const settledDescriptionInterests = mutations.getTrackMutationInterests({
    settled: true,
    sourceKind: "description",
  });
  const settledWatchShellMutation = mutations.classifyWatchMutations([mutation(watchShell)], {
    interests: settledDescriptionInterests,
  });
  assert.equal(settledWatchShellMutation.discovery, false);
  assert.equal(settledWatchShellMutation.media, true);
});

test("late YouTube Music description and action hydration trigger focused work", async () => {
  const { mutations } = await loadRuntime();
  const musicPage = new FakeNode("ytmusic-player-page", "#player-page");
  const description = new FakeNode("ytmusic-description-shelf-renderer");
  const actionRow = new FakeNode("ytmusic-player-page #actions");
  const player = new FakeNode("ytmusic-player");
  const playerChild = new FakeNode("video.html5-main-video");
  const unrelatedChild = new FakeNode("ytmusic-tab-renderer");
  musicPage.append(description, actionRow, player, unrelatedChild);
  player.append(playerChild);

  const descriptionResult = mutations.classifyWatchMutations([mutation(description)]);
  const actionResult = mutations.classifyWatchMutations([mutation(actionRow)]);
  const playerResult = mutations.classifyWatchMutations([mutation(playerChild)]);
  const unrelatedResult = mutations.classifyWatchMutations([mutation(unrelatedChild)]);

  assert.equal(descriptionResult.discovery, true);
  assert.equal(descriptionResult.domains.has(mutations.WATCH_MUTATION_DOMAINS.DESCRIPTION), true);
  assert.equal(actionResult.launcher, true);
  assert.equal(actionResult.discovery, false);
  assert.equal(playerResult.media, true);
  assert.equal(
    unrelatedResult.media,
    false,
    "ordinary player-page descendants must not all become media mutations"
  );
});

test("player mutations dispatch lightweight media work without parser discovery", async () => {
  const { mutations } = await loadRuntime();
  const player = new FakeNode("#movie_player", ".html5-video-player");
  const description = new FakeNode("#description-inline-expander");
  let discoverySchedules = 0;
  let mediaSchedules = 0;

  const playerResult = mutations.dispatchWatchMutations([mutation(player)], {
    onDiscovery: () => {
      discoverySchedules += 1;
    },
    onMedia: () => {
      mediaSchedules += 1;
    },
  });
  mutations.dispatchWatchMutations([mutation(description)], {
    onDiscovery: () => {
      discoverySchedules += 1;
    },
    onMedia: () => {
      mediaSchedules += 1;
    },
  });

  assert.equal(playerResult.discovery, false);
  assert.equal(playerResult.media, true);
  assert.equal(discoverySchedules, 1);
  assert.equal(mediaSchedules, 1);
});

test("structured-description panel visibility changes are description mutations", async () => {
  const { mutations } = await loadRuntime();
  const panel = new FakeNode(
    "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-structured-description']"
  );
  const result = mutations.classifyWatchMutations([mutation(panel)]);

  assert.equal(result.discovery, true);
  assert.equal(result.domains.has(mutations.WATCH_MUTATION_DOMAINS.DESCRIPTION), true);
});

test("observer roots prefer the active page container over the whole document", async () => {
  const { mutations } = await loadRuntime();
  const documentElement = new FakeNode("html");
  const pageManager = new FakeNode("ytd-page-manager");
  const root = {
    documentElement,
    querySelector(selector) {
      assert.equal(selector, "ytd-page-manager, ytmusic-app-layout");
      return pageManager;
    },
  };

  assert.equal(mutations.getPreferredWatchMutationRoot(root), pageManager);
  assert.equal(mutations.getPreferredWatchMutationRoot({
    documentElement,
    querySelector: () => null,
  }), documentElement);
});

test("observer configuration covers narrow visibility, text, and video-id hydration", async () => {
  const contentSource = await readFile(new URL("../src/content.js", import.meta.url), "utf8");

  assert.match(contentSource, /attributes: true/);
  assert.match(contentSource, /characterData: true/);
  assert.match(contentSource, /bindWatchPageObserver/);
  for (const attribute of [
    "ad-showing",
    "aria-expanded",
    "aria-hidden",
    "class",
    "hidden",
    "inert",
    "style",
    "video-id",
  ]) {
    assert.match(contentSource, new RegExp(`"${attribute}"`));
  }
  assert.match(
    contentSource,
    /restorePlayerAfterLauncherSync[\s\S]*playerLayout\.prepareMount\(\{ inlineCompact \}\)[\s\S]*playerLayout\.layoutNow\(/
  );
});

test("manifest loads focused performance runtimes before content orchestration", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const scripts = manifest.content_scripts[0].js;
  const contentIndex = scripts.indexOf("src/content.js");

  assert.ok(scripts.indexOf("src/video-resolver.js") < contentIndex);
  assert.ok(scripts.indexOf("src/session-media.js") < contentIndex);
  assert.ok(scripts.indexOf("src/watch-mutations.js") < contentIndex);
  assert.ok(scripts.indexOf("src/track-list-renderer.js") < contentIndex);
});
