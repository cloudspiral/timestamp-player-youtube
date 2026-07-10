(() => {
  const COMMENT_MIN_TRACKS = 3;
  const COMMENT_FETCH_BATCH_LIMIT = 3;
  const REGULAR_COMMENT_SCAN_LIMIT = 30;
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

    function getNativeSourceDiscovery(session, duration, observation) {
      const discovery = getNativeTimestampDiscovery(session.videoId);
      const candidateCount = discovery.candidates.length;
      if (discovery.hasMismatchedVideoId) {
        return { candidateCount, result: null };
      }

      const tracks = findTracks(duration, discovery.candidates);
      if (tracks.length < 2) {
        return { candidateCount, result: null };
      }

      const ownership = classifyNativeTrackSourceOwnership(
        discovery.candidates,
        session.videoId
      );
      if (!ownership) {
        return { candidateCount, result: null };
      }

      return {
        candidateCount,
        result: createTrackSourceResult({
          channel: "native-dom",
          duration,
          generation: session.generation,
          kind: TRACK_SOURCE_KINDS.NATIVE,
          observation,
          ownership,
          sourceId: "native-page",
          status: session.commentDiscovery.status === COMMENT_DISCOVERY_STATUSES.DONE
            ? TRACK_SOURCE_STATUSES.SETTLED
            : TRACK_SOURCE_STATUSES.PROVISIONAL,
          tracks,
          videoId: session.videoId,
        }),
      };
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

        const sourceId = getDomSourceId(session, root);
        const comment = youtubeDom.readCommentRoot(root, {
          sourceId,
          videoId: session.videoId,
        });
        candidateCount += comment.candidates.length;
        const sourceType = comment.isPinned
          ? COMMENT_SOURCE_TYPES.PINNED
          : comment.isUploader
            ? COMMENT_SOURCE_TYPES.UPLOADER
            : COMMENT_SOURCE_TYPES.REGULAR;
        if (sourceType === COMMENT_SOURCE_TYPES.REGULAR) {
          regularCommentCount += 1;
          if (regularCommentCount > REGULAR_COMMENT_SCAN_LIMIT) {
            continue;
          }
        }

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
        if (!getDomSourceOwnership(root, videoId)) {
          return false;
        }
        return youtubeDom.isDescriptionRootReadable(root);
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
      getDomCommentSourceResults,
      getFetchedCommentDiscoveryForSession,
      getNativeSourceDiscovery,
      isCommentDiscoveryPending,
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
