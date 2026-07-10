(() => {
  const DEFAULT_NEXT_API_PATH = "/youtubei/v1/next";
  const CONTINUATION_ENVELOPE_KEYS = new Set([
    "appendContinuationItemsAction",
    "continuationContents",
    "onResponseReceivedActions",
    "onResponseReceivedCommands",
    "onResponseReceivedEndpoints",
    "reloadContinuationItemsCommand",
  ]);
  const COMMENT_TEXT_KEYS = new Set([
    "contentText",
    "commentText",
  ]);
  const SEMANTIC_COMMENT_LIKE_FIELDS = Object.freeze([
    "likeCountLiked",
    "likeCountNotliked",
    "likeCount",
  ]);

  const {
    parseCommentLikeCount,
  } = globalThis.TimestampPlayerCommentScoring || {};

  function findBestCommentContinuation(root, { phase = "initial", seenTokens = new Set() } = {}) {
    const continuations = [];
    walkObjects(root, [], (value, ancestors, _key, path) => {
      const endpoint = value?.continuationEndpoint || value;
      const command = endpoint?.continuationCommand;
      const token = command?.token || value?.continuationCommand?.token;
      if (!token || seenTokens.has(token)) {
        return;
      }

      const apiUrl = endpoint?.commandMetadata?.webCommandMetadata?.apiUrl
        || value?.commandMetadata?.webCommandMetadata?.apiUrl
        || DEFAULT_NEXT_API_PATH;
      continuations.push({
        token,
        apiUrl,
        score: scoreContinuationCandidate(value, ancestors, apiUrl, token, path, phase),
      });
    });

    return continuations
      .filter((continuation) => continuation.score > 0)
      .sort((left, right) => right.score - left.score)[0] || null;
  }

  function scoreContinuationCandidate(value, ancestors, apiUrl, token, path, phase) {
    const text = stringifySmall([value, ...ancestors.slice(-4)]).toLowerCase();
    const pathText = path.join(".").toLowerCase();
    let score = 0;
    if (typeof apiUrl === "string" && apiUrl.includes("/next")) {
      score += 10;
    }
    if (text.includes("comment")) {
      score += 35;
    }
    if (text.includes("comments-section") || text.includes("comment-item-section")) {
      score += 40;
    }
    if (text.includes("sort filter") || text.includes("comment section")) {
      score += 15;
    }
    if (text.includes("playlist") || text.includes("transcript")) {
      score -= 20;
    }
    if (phase === "next") {
      if (pathText.includes("sortfiltersubmenurenderer") || text.includes("showreloaduicommand")) {
        score -= 100;
      }
      if (pathText.includes("commentrepliesrenderer") || token.includes("Y29tbWVudC1yZXBsaWVz")) {
        score -= 100;
      }
      if (/continuationitems\.\d+\.continuationitemrenderer(?:\.continuationendpoint)?$/.test(pathText)) {
        score += 60;
      }
      if (token.includes("Z2V0X3JhbmtlZF9zdHJlYW1z")) {
        score += 40;
      }
    }
    return score;
  }

  function stringifySmall(value) {
    try {
      return JSON.stringify(value).slice(0, 12000);
    } catch (_error) {
      return "";
    }
  }

  function isSupportedContinuationResponse(root) {
    if (!root || typeof root !== "object" || Array.isArray(root)) {
      return false;
    }

    let supported = false;
    walkObjects(root, [], (value, _ancestors, key) => {
      if (
        CONTINUATION_ENVELOPE_KEYS.has(key)
        || value?.commentRenderer
        || value?.commentViewModel
        || value?.commentEntityPayload
      ) {
        supported = true;
      }
    });
    return supported;
  }

  function extractCommentRecords(root) {
    const records = [];
    const pinnedCommentKeys = getPinnedCommentKeys(root);
    walkObjects(root, [], (value, ancestors) => {
      const parent = ancestors[ancestors.length - 1];
      if (value?.commentRenderer) {
        records.push(parseCommentRenderer(value.commentRenderer));
      }

      if (value?.commentViewModel && parent?.commentViewModel !== value) {
        records.push(parseCommentViewModel(value.commentViewModel));
      }

      if (value?.commentEntityPayload) {
        records.push(parseCommentEntityPayload(
          value.commentEntityPayload,
          pinnedCommentKeys,
          getEnclosingCommentEntityKey(ancestors)
        ));
      }
    });

    return mergeCommentRecords(records);
  }

  function getPinnedCommentKeys(root) {
    const pinnedCommentKeys = new Set();
    walkObjects(root, [], (value) => {
      if (!value?.commentViewModel) {
        return;
      }

      const model = unwrapCommentViewModel(value.commentViewModel);
      const commentKey = normalizeCommentIdentifier(model?.commentKey);
      if (commentKey && hasStructuralPinnedEvidence(model)) {
        pinnedCommentKeys.add(commentKey);
      }
    });
    return pinnedCommentKeys;
  }

  function parseCommentRenderer(renderer) {
    return {
      commentId: normalizeCommentIdentifier(renderer.commentId),
      commentKeys: normalizeCommentKeys([renderer.commentKey]),
      text: textFromTextObject(renderer.contentText),
      authorName: textFromTextObject(renderer.authorText),
      authorChannelId: normalizeCommentIdentifier(
        renderer.authorEndpoint?.browseEndpoint?.browseId
      ),
      isPinned: hasPinnedBadgeEvidence(renderer.pinnedCommentBadge),
      isUploader: renderer.authorIsChannelOwner === true,
      likeCount: parseSemanticLikeCountValue(renderer.voteCount),
    };
  }

  function parseCommentViewModel(rawModel) {
    const model = unwrapCommentViewModel(rawModel);
    const authorRenderer = model.author?.commentAuthorRenderer
      || model.commentAuthorRenderer
      || {};
    return {
      commentId: normalizeCommentIdentifier(model.commentId),
      commentKeys: normalizeCommentKeys([model.commentKey]),
      text: textFromCommentViewModel(model),
      authorName: textFromTextObject(authorRenderer.authorText) || textFromTextObject(model.authorText),
      authorChannelId: normalizeCommentIdentifier(
        authorRenderer.authorEndpoint?.browseEndpoint?.browseId
          || model.author?.channelId
          || model.authorChannelId
      ),
      isPinned: hasStructuralPinnedEvidence(model),
      isUploader: authorRenderer.authorIsChannelOwner === true
        || model.authorIsChannelOwner === true,
      likeCount: parseSemanticLikeCountFields(
        model,
        model.toolbar,
        model.toolbar?.commentToolbarViewModel,
        model.commentActionButtonsRenderer
      ),
    };
  }

  function parseCommentEntityPayload(
    entity,
    pinnedCommentKeys,
    enclosingEntityKey = ""
  ) {
    const properties = entity.properties || {};
    const author = entity.author || {};
    const commentKeys = normalizeCommentKeys([
      enclosingEntityKey,
      entity.key,
      entity.commentKey,
      properties.commentKey,
    ]);
    return {
      commentId: normalizeCommentIdentifier(properties.commentId || entity.commentId),
      commentKeys,
      text: textFromTextObject(properties.content),
      authorName: author.displayName || properties.authorButtonA11y || "",
      authorChannelId: normalizeCommentIdentifier(author.channelId),
      isPinned: commentKeys.some((commentKey) => pinnedCommentKeys.has(commentKey)),
      isUploader: author.isCreator === true,
      likeCount: parseSemanticLikeCountFields(
        entity.toolbar,
        entity.toolbar?.commentToolbarViewModel
      ),
    };
  }

  function getEnclosingCommentEntityKey(ancestors) {
    for (let index = ancestors.length - 1; index >= 0; index -= 1) {
      const entityKey = normalizeCommentIdentifier(ancestors[index]?.entityKey);
      if (entityKey) {
        return entityKey;
      }
    }
    return "";
  }

  function unwrapCommentViewModel(value) {
    let model = value;
    const seen = new Set();
    while (
      model
      && typeof model === "object"
      && model.commentViewModel
      && typeof model.commentViewModel === "object"
      && !seen.has(model)
    ) {
      seen.add(model);
      model = model.commentViewModel;
    }
    return model || {};
  }

  function hasStructuralPinnedEvidence(model) {
    return Boolean(
      model
      && (
        hasPinnedTextEvidence(model.pinnedText)
        || hasPinnedBadgeEvidence(model.pinnedCommentBadge)
      )
    );
  }

  function hasPinnedTextEvidence(value) {
    return Boolean(textFromTextObject(value).trim());
  }

  function hasPinnedBadgeEvidence(value) {
    if (value === true) {
      return true;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    return hasPinnedBadgeRenderer(value.pinnedCommentBadgeRenderer)
      || hasPinnedBadgeRenderer(value.pinnedCommentBadgeViewModel);
  }

  function hasPinnedBadgeRenderer(value) {
    return value === true
      || Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function textFromCommentViewModel(model) {
    if (typeof model.content?.content === "string") {
      return model.content.content;
    }
    if (typeof model.contentText === "string") {
      return model.contentText;
    }

    const directText = textFromTextObject(model.contentText)
      || textFromTextObject(model.commentText)
      || textFromTextObject(model.content);
    if (directText) {
      return directText;
    }

    const textContainers = [];
    walkObjects(model, [], (value, _ancestors, key) => {
      if (COMMENT_TEXT_KEYS.has(key) && typeof value === "object") {
        textContainers.push(value);
      }
    });

    return textContainers.map(textFromTextObject).find(Boolean) || "";
  }

  function textFromTextObject(value) {
    if (!value) {
      return "";
    }
    if (typeof value === "string") {
      return value;
    }
    if (typeof value.simpleText === "string") {
      return value.simpleText;
    }
    if (typeof value.content === "string") {
      return value.content;
    }
    if (Array.isArray(value.runs)) {
      return value.runs.map((run) => run.text || "").join("");
    }
    return "";
  }

  function parseSemanticLikeCountValue(value) {
    if (!parseCommentLikeCount || value == null) {
      return null;
    }

    if (typeof value === "number") {
      return Number.isFinite(value) && value >= 0 ? value : null;
    }

    const text = textFromTextObject(value);
    if (!text || !/\d/.test(text)) {
      return null;
    }

    const count = parseCommentLikeCount(text);
    return Number.isFinite(count) && count >= 0 ? count : null;
  }

  function parseSemanticLikeCountFields(...containers) {
    const counts = [];
    for (const container of containers) {
      if (!container || typeof container !== "object") {
        continue;
      }

      for (const field of SEMANTIC_COMMENT_LIKE_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(container, field)) {
          continue;
        }
        const count = parseSemanticLikeCountValue(container[field]);
        if (count !== null) {
          counts.push(count);
        }
      }
    }
    return counts.length ? Math.max(...counts) : null;
  }

  function mergeCommentRecords(...recordGroups) {
    const records = recordGroups
      .flat()
      .filter(Boolean)
      .map(normalizeCommentRecord)
      .filter((record) => record.text || getCommentRecordIdentityKeys(record).length);
    const parents = records.map((_, index) => index);
    const identityOwners = new Map();

    function find(index) {
      let root = index;
      while (parents[root] !== root) {
        root = parents[root];
      }
      while (parents[index] !== index) {
        const parent = parents[index];
        parents[index] = root;
        index = parent;
      }
      return root;
    }

    function union(leftIndex, rightIndex) {
      const leftRoot = find(leftIndex);
      const rightRoot = find(rightIndex);
      if (leftRoot === rightRoot) {
        return;
      }
      const firstRoot = Math.min(leftRoot, rightRoot);
      const laterRoot = Math.max(leftRoot, rightRoot);
      parents[laterRoot] = firstRoot;
    }

    records.forEach((record, index) => {
      for (const identityKey of getCommentRecordIdentityKeys(record)) {
        const owner = identityOwners.get(identityKey);
        if (owner === undefined) {
          identityOwners.set(identityKey, index);
        } else {
          union(index, owner);
        }
      }
    });

    const mergedByRoot = new Map();
    records.forEach((record, index) => {
      const root = find(index);
      const existing = mergedByRoot.get(root);
      mergedByRoot.set(root, existing ? mergeCommentRecord(existing, record) : record);
    });
    return [...mergedByRoot.values()].filter((record) => record.text);
  }

  function normalizeCommentRecord(record) {
    return {
      commentId: normalizeCommentIdentifier(record.commentId),
      commentKeys: normalizeCommentKeys([
        ...(Array.isArray(record.commentKeys) ? record.commentKeys : []),
        record.commentKey,
      ]),
      text: typeof record.text === "string" ? record.text : "",
      authorName: typeof record.authorName === "string" ? record.authorName : "",
      authorChannelId: normalizeCommentIdentifier(record.authorChannelId),
      isPinned: record.isPinned === true,
      isUploader: record.isUploader === true,
      likeCount: Number.isFinite(record.likeCount) && record.likeCount >= 0
        ? record.likeCount
        : null,
      ...(Number.isFinite(record.order) ? { order: record.order } : {}),
    };
  }

  function mergeCommentRecord(existing, incoming) {
    const likeCounts = [existing.likeCount, incoming.likeCount].filter(Number.isFinite);
    const existingOrder = Number.isFinite(existing.order)
      ? existing.order
      : Number.POSITIVE_INFINITY;
    const incomingOrder = Number.isFinite(incoming.order)
      ? incoming.order
      : Number.POSITIVE_INFINITY;
    const order = Math.min(existingOrder, incomingOrder);
    return {
      commentId: existing.commentId || incoming.commentId,
      commentKeys: normalizeCommentKeys([
        ...existing.commentKeys,
        ...incoming.commentKeys,
      ]),
      text: chooseRicherCommentText(existing.text, incoming.text),
      authorName: existing.authorName || incoming.authorName,
      authorChannelId: existing.authorChannelId || incoming.authorChannelId,
      isPinned: existing.isPinned || incoming.isPinned,
      isUploader: existing.isUploader || incoming.isUploader,
      likeCount: likeCounts.length ? Math.max(...likeCounts) : null,
      ...(Number.isFinite(order) ? { order } : {}),
    };
  }

  function chooseRicherCommentText(existingText, incomingText) {
    return normalizeCommentBodyForComparison(incomingText).length
      > normalizeCommentBodyForComparison(existingText).length
      ? incomingText
      : existingText;
  }

  function getCommentRecordIdentityKeys(record) {
    return normalizeCommentKeys([record.commentId, ...record.commentKeys])
      .map((identifier) => `comment:${identifier}`);
  }

  function normalizeCommentKeys(keys) {
    return [...new Set(keys.map(normalizeCommentIdentifier).filter(Boolean))];
  }

  function normalizeCommentIdentifier(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeCommentBodyForComparison(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function walkObjects(value, ancestors, visitor, key = "", path = []) {
    if (!value || typeof value !== "object") {
      visitor(value, ancestors, key, path);
      return;
    }

    visitor(value, ancestors, key, path);
    const nextAncestors = [...ancestors, value];
    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        const childKey = String(index);
        walkObjects(entry, nextAncestors, visitor, childKey, [...path, childKey]);
      });
      return;
    }

    for (const [childKey, childValue] of Object.entries(value)) {
      walkObjects(childValue, nextAncestors, visitor, childKey, [...path, childKey]);
    }
  }

  globalThis.TimestampPlayerCommentData = {
    extractCommentRecords,
    findBestCommentContinuation,
    isSupportedContinuationResponse,
    mergeCommentRecords,
  };
})();
