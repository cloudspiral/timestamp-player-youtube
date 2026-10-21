(() => {
  const COMMENT_MIN_TRACKS = 3;
  const COMMENT_FETCH_BATCH_LIMIT = 3;
  const REGULAR_COMMENT_SCAN_LIMIT = 30;
  const { buildChapterTracks, chapterKindFromKey, extractChapterSets, isChapterPanelId } = globalThis.TimestampPlayerChapterData;
  const { createPageDataLoader } = globalThis.TimestampPlayerYouTubePageData;
  const {
    COMMENT_SOURCE_TYPES,
    scoreCommentTrackSource,
  } = globalThis.TimestampPlayerCommentScoring;
  const {
    COMMENT_FETCH_OUTCOMES,
    fetchCommentRecords,
  } = globalThis.TimestampPlayerCommentFetching;
  const {
    createFetchedCommentSeeds,
    mergeFetchedCommentSeeds,
    selectFetchedCommentSource,
  } = globalThis.TimestampPlayerFetchedCommentSources;
  const {
    getNativeTimestampDiscovery,
  } = globalThis.TimestampPlayerNativeTimestamps;
  const {
    findTracks,
  } = globalThis.TimestampPlayerTimestamps;
  const {
    TRACK_SOURCE_KINDS,
    TRACK_SOURCE_STATUSES,
    classifyNativeTrackSourceOwnership,
    classifyTrackSourceOwnership,
    createTrackSourceResult,
  } = globalThis.TimestampPlayerTrackSelection;
  const {
    COMMENT_DISCOVERY_STATUSES,
    resetSessionRetry,
  } = globalThis.TimestampPlayerWatchSession;

  function createTrackDiscoveryController({
    diagnostics,
    isCurrentSession,
    scheduleScan,
    scheduleTrackedSessionRetry,
    youtubeDom,
  }) {
    if (
      !diagnostics
      || typeof isCurrentSession !== "function"
      || typeof scheduleScan !== "function"
      || typeof scheduleTrackedSessionRetry !== "function"
      || !youtubeDom
    ) {
      throw new TypeError("Track discovery dependencies are required");
    }

    function getDescriptionSourceResults(session, duration, observation) {
      const results = [];
      let candidateCount = 0;

      for (const root of youtubeDom.getDescriptionRoots(session.videoId)) {
        const ownership = getDomSourceOwnership(root, session.videoId);
        if (!ownership) {
          continue;
        }

        const sourceId = getDomSourceId(session, root);
        const discovery = youtubeDom.readDescriptionRoot(root, {
          sourceId,
          videoId: session.videoId,
        });
        if (!discovery) {
          continue;
        }

        candidateCount = Math.max(candidateCount, discovery.candidateCount);
        const tracks = findTracks(duration, discovery.candidates);
        if (tracks.length < 2) {
          continue;
        }

        results.push(createTrackSourceResult({
          channel: "description-dom",
          duration,
          generation: session.generation,
          kind: TRACK_SOURCE_KINDS.DESCRIPTION,
          observation,
          ownership,
          sourceId,
          status: TRACK_SOURCE_STATUSES.SETTLED,
          tracks,
          videoId: session.videoId,
        }));
      }

    return { candidateCount, results };
    }

    function getPageDataLoader(session) {
      session.pageDataLoader ||= createPageDataLoader(session.videoId, session.abortController.signal);
      return session.pageDataLoader;
    }

    function getChapterSourceDiscovery(session, duration, observation) {
      const discovery = session.chapterDiscovery;
      const loader = getPageDataLoader(session);
      const localSets = extractChapterSets(loader.readDocument()?.initialData, session.videoId);
      const hasComplete = localSets.some((set) => set.complete && buildChapterTracks(set.candidates, duration).length >= 2);
      if (discovery.status === "idle") {
        if (hasComplete) {
          discovery.status = "done";
        } else {
          startChapterFetch(session);
        }
      }
      const results = [];
      for (const [transport, sets] of [["document", localSets], ["fetch", discovery.sets]]) {
        for (const set of sets) {
          const tracks = buildChapterTracks(set.candidates, duration, { requireZero: set.complete });
          if (tracks.length < 2) {
            continue;
          }
          results.push(createTrackSourceResult({
            channel: set.complete ? set.channel : "native-panel",
            chapterKind: set.chapterKind,
            kind: set.complete ? TRACK_SOURCE_KINDS.CHAPTER : TRACK_SOURCE_KINDS.NATIVE,
            sourceId: `${transport}:${set.sourceId}`,
            duration, generation: session.generation, observation, videoId: session.videoId,
            ownership: { confidence: "strong", evidence: "page-video-id" },
            status: set.complete || (discovery.status === "done" && session.commentDiscovery.status === COMMENT_DISCOVERY_STATUSES.DONE)
              ? TRACK_SOURCE_STATUSES.SETTLED : TRACK_SOURCE_STATUSES.PROVISIONAL,
            tracks,
          }));
        }
      }
      return { results, candidateCount: [...localSets, ...discovery.sets].reduce((sum, set) => sum + set.candidates.length, 0) };
    }

    function startChapterFetch(session) {
      const discovery = session.chapterDiscovery;
      discovery.status = "pending";
      getPageDataLoader(session).fetchPage().then((page) => {
        if (isCurrentSession(session)) {
          discovery.sets = extractChapterSets(page.initialData, session.videoId);
          discovery.status = "done";
        }
      }, (error) => {
        if (!isCurrentSession(session)) {
          return;
        }
        const retryable = error?.kind === "transient" && error?.reason !== "aborted";
        const retryScheduled = retryable && scheduleTrackedSessionRetry(session, "chapterFetch", () => {
          if (isCurrentSession(session)) {
            getPageDataLoader(session).retryTransient();
            startChapterFetch(session);
          }
        });
        discovery.status = retryScheduled ? "retry-wait" : "done";
      }).finally(() => {
        if (isCurrentSession(session)) {
          scheduleScan(session);
        }
      });
    }

    function isChapterDiscoveryPending(session) {
      return ["pending", "retry-wait"].includes(session.chapterDiscovery.status);
    }

    function getNativeSourceDiscovery(session, duration, observation) {
      const discovery = getNativeTimestampDiscovery(session.videoId);
      const candidateCount = discovery.candidates.length;
      if (discovery.hasMismatchedVideoId) {
        return { candidateCount, result: null };
      }

      const results = [];
      const groups = discovery.groups || [{ candidates: discovery.candidates }];
      for (const [index, group] of groups.entries()) {
        const chapterPanel = isChapterPanelId(group.panelId);
        if (group.incomplete) {
          continue;
        }
        const complete = chapterPanel && group.candidates[0]?.start === 0;
        const tracks = chapterPanel
          ? buildChapterTracks(group.candidates, duration, { requireZero: complete })
          : findTracks(duration, group.candidates);
        const ownership = classifyNativeTrackSourceOwnership(group.candidates, session.videoId);
        if (!ownership || tracks.length < 2) {
          continue;
        }
        results.push(createTrackSourceResult({
          channel: complete ? "chapter-dom" : "native-dom",
          chapterKind: chapterKindFromKey(group.panelId),
          duration,
          generation: session.generation,
          kind: complete ? TRACK_SOURCE_KINDS.CHAPTER : TRACK_SOURCE_KINDS.NATIVE,
          observation,
          ownership,
          sourceId: `native-page:${index}`,
          status: complete || session.commentDiscovery.status === COMMENT_DISCOVERY_STATUSES.DONE
            ? TRACK_SOURCE_STATUSES.SETTLED
            : TRACK_SOURCE_STATUSES.PROVISIONAL,
          tracks,
          videoId: session.videoId,
        }));
      }
      return { candidateCount, results, result: results[0] || null };
    }

    function getDomCommentSourceResults(session, duration, observation, status) {
      const results = [];
      let candidateCount = 0;
      let regularCommentCount = 0;

      for (const [order, root] of youtubeDom.getCommentRoots(session.videoId).entries()) {
        const ownership = getDomSourceOwnership(root, session.videoId);
        if (!ownership) {
          continue;
        }

        const classification = youtubeDom.classifyCommentRoot(root, session.videoId);
        const sourceType = classification.isPinned
          ? COMMENT_SOURCE_TYPES.PINNED
          : classification.isUploader
            ? COMMENT_SOURCE_TYPES.UPLOADER
            : COMMENT_SOURCE_TYPES.REGULAR;
        if (sourceType === COMMENT_SOURCE_TYPES.REGULAR) {
          if (regularCommentCount >= REGULAR_COMMENT_SCAN_LIMIT) {
            continue;
          }
          regularCommentCount += 1;
        }

        const sourceId = getDomSourceId(session, root);
        const comment = youtubeDom.readCommentRoot(root, {
          classification,
          sourceId,
          videoId: session.videoId,
        });
        candidateCount += comment.candidates.length;
        const tracks = findTracks(duration, comment.candidates, COMMENT_MIN_TRACKS);
        if (tracks.length < COMMENT_MIN_TRACKS) {
          continue;
        }

        const scoredSource = {
          duration,
          likeCount: comment.likeCount,
          order,
          sourceType,
          tracks,
        };
        results.push(createTrackSourceResult({
          channel: "comment-dom",
          duration,
          generation: session.generation,
          kind: TRACK_SOURCE_KINDS.COMMENT,
          observation,
          ownership,
          sourceId,
          sourceScore: scoreCommentTrackSource(scoredSource),
          status,
          tracks,
          videoId: session.videoId,
        }));
      }

      return { candidateCount, results };
    }

    function isCommentDiscoveryPending(session) {
      return session.commentDiscovery.status === COMMENT_DISCOVERY_STATUSES.PENDING
        || session.commentDiscovery.status === COMMENT_DISCOVERY_STATUSES.RETRY_WAIT;
    }

    function getFetchedCommentDiscoveryForSession(session, duration) {
      const discovery = session.commentDiscovery;
      if (discovery.status === COMMENT_DISCOVERY_STATUSES.IDLE) {
        startCommentFetch(session);
      }
      refreshFetchedCommentResult(session, duration);
      return discovery;
    }

    function refreshFetchedCommentResult(session, duration) {
      const discovery = session.commentDiscovery;
      const sourceStatus = discovery.status === COMMENT_DISCOVERY_STATUSES.DONE
        ? TRACK_SOURCE_STATUSES.SETTLED
        : TRACK_SOURCE_STATUSES.PROVISIONAL;
      if (
        discovery.resultDuration === duration
        && discovery.resultSeeds === discovery.seeds
        && discovery.resultStatus === sourceStatus
      ) {
        return;
      }

      discovery.result = selectFetchedCommentSource({
        duration,
        generation: session.generation,
        observation: session.trackSelection.observation,
        seeds: discovery.seeds,
        status: sourceStatus,
        videoId: session.videoId,
      });
      discovery.resultDuration = duration;
      discovery.resultSeeds = discovery.seeds;
      discovery.resultStatus = sourceStatus;
    }

    function startCommentFetch(session) {
      const { videoId } = session;
      const discovery = session.commentDiscovery;
      discovery.attempt += 1;
      const attempt = discovery.attempt;
      discovery.attemptStartedAt = Date.now();
      diagnostics.commentFetchStarted(session);
      if (typeof fetchCommentRecords !== "function") {
        const result = {
          batchesFetched: 0,
          reason: "fetch-unavailable",
          records: [],
          retryable: false,
          status: COMMENT_FETCH_OUTCOMES.UNSUPPORTED,
        };
        discovery.status = COMMENT_DISCOVERY_STATUSES.DONE;
        discovery.result = null;
        discovery.resultDuration = null;
        discovery.resultSeeds = null;
        discovery.resultStatus = null;
        diagnostics.commentFetchResult(session, result, 0);
        discovery.attemptStartedAt = null;
        return discovery;
      }

      discovery.status = COMMENT_DISCOVERY_STATUSES.PENDING;
      fetchCommentRecords({
        loadPageData: () => getPageDataLoader(session).load(),
        maxBatches: COMMENT_FETCH_BATCH_LIMIT,
        signal: session.abortController.signal,
        videoId,
      })
        .then(
          (result) => finishCommentFetch(session, attempt, result),
          () => finishCommentFetch(session, attempt, {
            batchesFetched: 0,
            reason: "unexpected-rejection",
            records: [],
            retryable: true,
            status: COMMENT_FETCH_OUTCOMES.TRANSIENT_ERROR,
          })
        )
        .finally(() => {
          if (isCurrentSession(session) && discovery.attempt === attempt) {
            scheduleScan(session);
          }
        });
      return discovery;
    }

    function finishCommentFetch(session, attempt, result) {
      if (!isCurrentSession(session) || session.commentDiscovery.attempt !== attempt) {
        return;
      }

      const discovery = session.commentDiscovery;
      const records = Array.isArray(result?.records) ? result.records : [];
      const incomingSeeds = createFetchedCommentSeeds(records);
      const retryable = shouldRetryCommentFetch(result);
      const retryScheduled = retryable && scheduleTrackedSessionRetry(
        session,
        "commentFetch",
        () => {
          if (isCurrentSession(session)) {
            startCommentFetch(session);
          }
        }
      );
      discovery.status = retryScheduled
        ? COMMENT_DISCOVERY_STATUSES.RETRY_WAIT
        : COMMENT_DISCOVERY_STATUSES.DONE;
      discovery.seeds = mergeFetchedCommentSeeds(
        discovery.seeds,
        incomingSeeds
      );
      discovery.result = null;
      discovery.resultDuration = null;
      discovery.resultSeeds = null;
      discovery.resultStatus = null;
      if (!retryScheduled && !retryable) {
        resetSessionRetry(session, "commentFetch");
      }
      diagnostics.commentFetchResult(session, result, incomingSeeds.length > 0 ? 1 : 0);
      discovery.attemptStartedAt = null;
    }

    function canReadQuietDescription(videoId) {
      return youtubeDom.getQuietDescriptionRoots(videoId).some((root) => {
        return Boolean(
          getDomSourceOwnership(root, videoId)
          && youtubeDom.isDescriptionRootReadable(root)
        );
      });
    }

    function getDomSourceOwnership(root, videoId) {
      return classifyTrackSourceOwnership({
        ...youtubeDom.getOwnershipEvidence(root),
        videoId,
      });
    }

    function getDomSourceId(session, root) {
      let sourceId = session.domSources.ids.get(root);
      if (!sourceId) {
        sourceId = String(session.domSources.nextId);
        session.domSources.nextId += 1;
        session.domSources.ids.set(root, sourceId);
      }
      return sourceId;
    }

    return Object.freeze({
      canReadQuietDescription,
      getDescriptionSourceResults,
      getChapterSourceDiscovery,
      getDomCommentSourceResults,
      getFetchedCommentDiscoveryForSession,
      getNativeSourceDiscovery,
      isCommentDiscoveryPending,
      isChapterDiscoveryPending,
    });
  }

  function shouldRetryCommentFetch(result) {
    return Boolean(
      result?.retryable
      && (
        result.status === COMMENT_FETCH_OUTCOMES.PARTIAL
        || result.status === COMMENT_FETCH_OUTCOMES.TRANSIENT_ERROR
        || result.status === COMMENT_FETCH_OUTCOMES.UNSUPPORTED
      )
    );
  }

  globalThis.TimestampPlayerTrackDiscovery = {
    createTrackDiscoveryController,
  };
})();
