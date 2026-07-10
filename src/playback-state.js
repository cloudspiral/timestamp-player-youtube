(() => {
  const MAX_HISTORY_LENGTH = 100;
  const REPEAT_MODES = Object.freeze({
    OFF: "off",
    ONE: "one",
  });
  const PLAYBACK_BOUNDARY_ACTIONS = Object.freeze({
    NONE: "none",
    REPEAT_ONE: "repeat-one",
    SHUFFLE_NEXT: "shuffle-next",
  });

  function createPlaybackState({
    history = [],
    repeatMode = REPEAT_MODES.OFF,
    shuffleEnabled = false,
    upcoming = [],
  } = {}) {
    return {
      history: [...history],
      repeatMode: Object.values(REPEAT_MODES).includes(repeatMode) ? repeatMode : REPEAT_MODES.OFF,
      shuffleEnabled: shuffleEnabled === true,
      upcoming: [...upcoming],
    };
  }

  function clearPlaybackOrder(state) {
    return {
      ...state,
      history: [],
      upcoming: [],
    };
  }

  function toggleShuffle(state, trackCount) {
    const shuffleEnabled = !state.shuffleEnabled && trackCount >= 2;
    if (shuffleEnabled) {
      return {
        ...clearPlaybackOrder(state),
        shuffleEnabled: true,
      };
    }

    return {
      ...state,
      shuffleEnabled: false,
      upcoming: [],
    };
  }

  function toggleRepeat(state, trackCount) {
    const repeatMode = state.repeatMode === REPEAT_MODES.ONE
      ? REPEAT_MODES.OFF
      : REPEAT_MODES.ONE;
    return {
      ...state,
      repeatMode: repeatMode !== REPEAT_MODES.OFF && trackCount < 2
        ? REPEAT_MODES.OFF
        : repeatMode,
    };
  }

  function getPlaybackPositionDecision(state, {
    activeTrackIndex = -1,
    currentTime = NaN,
    seeking = false,
    tracks = [],
  } = {}) {
    const safeTracks = Array.isArray(tracks) ? tracks : [];
    const trackIndex = getTrackIndexAtTime(safeTracks, currentTime);
    const trackEnd = safeTracks[activeTrackIndex]?.end;
    let boundaryAction = PLAYBACK_BOUNDARY_ACTIONS.NONE;

    if (
      !seeking
      && Number.isFinite(currentTime)
      && Number.isFinite(trackEnd)
      && currentTime >= trackEnd
    ) {
      if (state?.repeatMode === REPEAT_MODES.ONE) {
        boundaryAction = PLAYBACK_BOUNDARY_ACTIONS.REPEAT_ONE;
      } else if (state?.shuffleEnabled === true) {
        boundaryAction = PLAYBACK_BOUNDARY_ACTIONS.SHUFFLE_NEXT;
      }
    }

    return { boundaryAction, trackIndex };
  }

  function getTrackIndexAtTime(tracks, currentTime) {
    if (!Array.isArray(tracks) || !Number.isFinite(currentTime)) {
      return -1;
    }

    return tracks.findIndex((track) => {
      return Number.isFinite(track?.start)
        && Number.isFinite(track?.end)
        && currentTime >= track.start
        && currentTime < track.end;
    });
  }

  function selectNextTrack(state, {
    currentIndex = -1,
    random = Math.random,
    trackCount = 0,
    tracksAvailable = trackCount >= 2,
  } = {}) {
    if (!state.shuffleEnabled) {
      return {
        index: getNextSequentialTrackIndex(currentIndex, trackCount, tracksAvailable),
        state,
      };
    }

    let upcoming = [...state.upcoming];
    while (upcoming.length && (!isValidTrackIndex(upcoming[0], trackCount) || upcoming[0] === currentIndex)) {
      upcoming.shift();
    }
    if (!upcoming.length) {
      upcoming = shuffleIndices(
        Array.from({ length: trackCount }, (_value, index) => index)
          .filter((index) => index !== currentIndex),
        random
      );
    }

    const nextIndex = upcoming.shift();
    return {
      index: nextIndex ?? getNextSequentialTrackIndex(currentIndex, trackCount, tracksAvailable),
      state: {
        ...state,
        upcoming,
      },
    };
  }

  function selectPreviousTrack(state, {
    currentIndex = -1,
    trackCount = 0,
    tracksAvailable = trackCount >= 2,
  } = {}) {
    if (!state.shuffleEnabled) {
      return {
        index: getPreviousSequentialTrackIndex(currentIndex, tracksAvailable),
        state,
      };
    }

    const history = [...state.history];
    const previousIndex = history.length ? history.pop() : currentIndex;
    let nextState = {
      ...state,
      history,
    };
    if (previousIndex !== currentIndex) {
      nextState = queueTrackNext(nextState, currentIndex, trackCount);
    }
    return {
      index: previousIndex,
      state: nextState,
    };
  }

  function recordTrackSelection(state, {
    nextIndex,
    previousIndex,
    recordHistory = true,
    trackCount = 0,
  } = {}) {
    let history = state.history;
    if (
      recordHistory
      && isValidTrackIndex(previousIndex, trackCount)
      && previousIndex !== nextIndex
    ) {
      history = [...state.history, previousIndex];
      if (history.length > MAX_HISTORY_LENGTH) {
        history = history.slice(history.length - MAX_HISTORY_LENGTH);
      }
    }

    return {
      ...state,
      history,
      upcoming: state.upcoming.filter((trackIndex) => trackIndex !== nextIndex),
    };
  }

  function queueTrackNext(state, index, trackCount) {
    if (!isValidTrackIndex(index, trackCount)) {
      return state;
    }

    return {
      ...state,
      upcoming: [index, ...state.upcoming.filter((trackIndex) => trackIndex !== index)],
    };
  }

  function getNextSequentialTrackIndex(currentIndex, trackCount, tracksAvailable) {
    if (!tracksAvailable) {
      return -1;
    }
    if (currentIndex < 0) {
      return 0;
    }
    return (currentIndex + 1) % trackCount;
  }

  function getPreviousSequentialTrackIndex(currentIndex, tracksAvailable) {
    if (!tracksAvailable) {
      return -1;
    }
    if (currentIndex <= 0) {
      return 0;
    }
    return currentIndex - 1;
  }

  function shuffleIndices(indices, random) {
    const shuffled = [...indices];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
  }

  function isValidTrackIndex(index, trackCount) {
    return Number.isInteger(index) && index >= 0 && index < trackCount;
  }

  globalThis.TimestampPlayerPlaybackState = {
    PLAYBACK_BOUNDARY_ACTIONS,
    REPEAT_MODES,
    clearPlaybackOrder,
    createPlaybackState,
    getPlaybackPositionDecision,
    getTrackIndexAtTime,
    recordTrackSelection,
    selectNextTrack,
    selectPreviousTrack,
    toggleRepeat,
    toggleShuffle,
  };
})();
