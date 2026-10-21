(() => {
  const WATCH_MUTATION_DOMAINS = Object.freeze({
    ACTIONS: "actions",
    COMMENTS: "comments",
    DESCRIPTION: "description",
    LAYOUT: "layout",
    NATIVE: "native",
    PLAYER: "player",
  });
  const WATCH_MUTATION_ROOT_SELECTOR = "ytd-page-manager, ytmusic-app-layout";
  const DIRECT_MATCH_ONLY_SELECTORS = new Set([
    "#movie_player",
    ".html5-video-player",
    "ytd-watch-flexy",
    "ytd-player",
    "ytmusic-player",
    "ytmusic-player-page",
    "#player-page",
  ]);

  const DOMAIN_SELECTORS = Object.freeze({
    [WATCH_MUTATION_DOMAINS.ACTIONS]: Object.freeze([
      "#top-level-buttons-computed",
      "ytd-watch-metadata #actions",
      "#above-the-fold #actions",
      "ytmusic-player-page #actions",
    ]),
    [WATCH_MUTATION_DOMAINS.COMMENTS]: Object.freeze([
      "ytd-comments",
      "ytd-comment-thread-renderer",
      "ytd-comment-view-model",
      "ytd-comment-renderer",
      "ytd-video-owner-renderer",
    ]),
    [WATCH_MUTATION_DOMAINS.DESCRIPTION]: Object.freeze([
      "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-structured-description']",
      "ytd-watch-metadata #description",
      "#description-inline-expander",
      "ytd-watch-metadata ytd-text-inline-expander",
      "ytd-expandable-video-description-body-renderer",
      "ytd-structured-description-content-renderer",
      "ytmusic-description-shelf-renderer",
    ]),
    [WATCH_MUTATION_DOMAINS.LAYOUT]: Object.freeze([
      "ytd-watch-metadata #title",
      "#above-the-fold #title",
      "ytmusic-player-page #header .title",
      "ytmusic-player-page #header #title",
      "ytd-watch-flexy",
      "ytmusic-player-page",
    ]),
    [WATCH_MUTATION_DOMAINS.NATIVE]: Object.freeze([
      "ytd-watch-metadata ytd-horizontal-card-list-renderer",
      "ytd-engagement-panel-section-list-renderer ytd-horizontal-card-list-renderer",
      "ytd-macro-markers-list-renderer",
      "ytd-macro-markers-list-item-renderer",
    ]),
    [WATCH_MUTATION_DOMAINS.PLAYER]: Object.freeze([
      "video.html5-main-video",
      "#movie_player",
      ".html5-video-player",
      "ytd-player",
      "ytd-watch-flexy",
      "ytmusic-player",
      "ytmusic-player-page",
      "#player-page",
    ]),
  });

  function getTrackMutationInterests({
    needsTitleEnrichment = false,
    settled = false,
    sourceKind = "",
  } = {}) {
    if (!settled || !sourceKind) {
      return allDiscoveryInterests();
    }

    return {
      [WATCH_MUTATION_DOMAINS.COMMENTS]: !["description", "chapter"].includes(sourceKind) || needsTitleEnrichment,
      [WATCH_MUTATION_DOMAINS.DESCRIPTION]: true,
      [WATCH_MUTATION_DOMAINS.NATIVE]: true,
      // Player ownership and ad state remain live after track discovery settles.
      // Keeping this narrow domain active lets content re-resolve media without
      // re-running description/comment discovery for every player mutation.
      [WATCH_MUTATION_DOMAINS.PLAYER]: true,
    };
  }

  function allDiscoveryInterests() {
    return {
      [WATCH_MUTATION_DOMAINS.COMMENTS]: true,
      [WATCH_MUTATION_DOMAINS.DESCRIPTION]: true,
      [WATCH_MUTATION_DOMAINS.NATIVE]: true,
      [WATCH_MUTATION_DOMAINS.PLAYER]: true,
    };
  }

  function dispatchWatchMutations(mutations, {
    getNodeDomains = getWatchNodeDomains,
    interests = allDiscoveryInterests(),
    isExtensionNode = () => false,
    onDiscovery = () => {},
    onLauncher = () => {},
    onLayout = () => {},
    onMedia = () => {},
  } = {}) {
    const classification = classifyWatchMutations(mutations, {
      getNodeDomains,
      interests,
      isExtensionNode,
    });
    if (classification.discovery) {
      onDiscovery(classification);
    }
    if (classification.launcher) {
      onLauncher(classification);
    }
    if (classification.layout) {
      onLayout(classification);
    }
    if (classification.media) {
      onMedia(classification);
    }
    return classification;
  }

  function getPreferredWatchMutationRoot(root = document) {
    return root?.querySelector?.(WATCH_MUTATION_ROOT_SELECTOR)
      || root?.documentElement
      || null;
  }

  function classifyWatchMutations(mutations, {
    getNodeDomains = getWatchNodeDomains,
    interests = allDiscoveryInterests(),
    isExtensionNode = () => false,
  } = {}) {
    const domains = new Set();
    for (const mutation of mutations || []) {
      if (isExtensionOnlyMutation(mutation, isExtensionNode)) {
        continue;
      }

      addDomains(domains, getNodeDomains(mutation.target, { includeDescendants: false }));
      for (const node of [...(mutation.addedNodes || []), ...(mutation.removedNodes || [])]) {
        addDomains(domains, getNodeDomains(node, { includeDescendants: true }));
      }
    }

    const discovery = [
      WATCH_MUTATION_DOMAINS.COMMENTS,
      WATCH_MUTATION_DOMAINS.DESCRIPTION,
      WATCH_MUTATION_DOMAINS.NATIVE,
    ].some((domain) => domains.has(domain) && interests[domain] !== false);
    const media = domains.has(WATCH_MUTATION_DOMAINS.PLAYER)
      && interests[WATCH_MUTATION_DOMAINS.PLAYER] !== false;

    return {
      discovery,
      domains,
      launcher: domains.has(WATCH_MUTATION_DOMAINS.ACTIONS),
      layout: domains.has(WATCH_MUTATION_DOMAINS.ACTIONS)
        || domains.has(WATCH_MUTATION_DOMAINS.LAYOUT),
      media,
    };
  }

  function isExtensionOnlyMutation(mutation, isExtensionNode) {
    if (isExtensionNode(mutation?.target)) {
      return true;
    }

    const addedNodes = [...(mutation?.addedNodes || [])];
    const removedNodes = [...(mutation?.removedNodes || [])];
    return removedNodes.length === 0
      && addedNodes.length > 0
      && addedNodes.every(isExtensionNode);
  }

  function getWatchNodeDomains(node, { includeDescendants = false } = {}) {
    const element = toElement(node);
    if (!element) {
      return [];
    }

    const directDomains = new Set();
    const descendantDomains = new Set();
    for (const [domain, selectors] of Object.entries(DOMAIN_SELECTORS)) {
      if (selectors.some((selector) => matchesOrClosest(element, selector))) {
        directDomains.add(domain);
      }
      if (
        includeDescendants
        && typeof element.querySelector === "function"
        && selectors.some((selector) => safelyQuery(element, selector))
      ) {
        descendantDomains.add(domain);
      }
    }

    // Native moment cards can live inside structured-description containers.
    // Their own mutations should not force the higher-tier description parser.
    if (directDomains.has(WATCH_MUTATION_DOMAINS.NATIVE)) {
      directDomains.delete(WATCH_MUTATION_DOMAINS.DESCRIPTION);
    }

    return [...directDomains, ...descendantDomains];
  }

  function toElement(node) {
    if (!node) {
      return null;
    }
    return node.nodeType === 1 ? node : node.parentElement || null;
  }

  function matchesOrClosest(element, selector) {
    try {
      if (element.matches?.(selector)) {
        return true;
      }
      return DIRECT_MATCH_ONLY_SELECTORS.has(selector)
        ? false
        : Boolean(element.closest?.(selector));
    } catch (_error) {
      return false;
    }
  }

  function safelyQuery(element, selector) {
    try {
      return element.querySelector(selector);
    } catch (_error) {
      return null;
    }
  }

  function addDomains(target, domains) {
    for (const domain of domains || []) {
      target.add(domain);
    }
  }

  globalThis.TimestampPlayerWatchMutations = {
    WATCH_MUTATION_DOMAINS,
    classifyWatchMutations,
    dispatchWatchMutations,
    getPreferredWatchMutationRoot,
    getTrackMutationInterests,
    getWatchNodeDomains,
  };
})();
