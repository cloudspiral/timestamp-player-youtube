(() => {
  const {
    VIDEO_RESOLUTION_STATUSES,
    resolveActiveVideo,
  } = globalThis.TimestampPlayerVideoResolver;
  const {
    bindSessionMedia,
    clearSessionMedia,
    isSessionMediaCurrent,
  } = globalThis.TimestampPlayerWatchSession;

  const SESSION_MEDIA_EVENTS = Object.freeze([
    "timeupdate",
    "seeking",
    "seeked",
    "ended",
    "play",
    "pause",
    "loadedmetadata",
    "durationchange",
    "emptied",
  ]);

  function resolveAndBindSessionMedia(session, {
    getComputedStyle = globalThis.getComputedStyle,
    hostname = globalThis.location?.hostname || "",
    onEvent = () => {},
    root = globalThis.document,
    videoId = session?.videoId || "",
  } = {}) {
    const resolution = resolveActiveVideo({
      getComputedStyle,
      hostname,
      previousElement: session?.media?.element || null,
      root,
      videoId,
    });

    if (!session?.media || session.media.closed) {
      return resolution;
    }

    if (!resolution.element) {
      clearSessionMedia(session);
      session.media.resolution = resolution;
      return resolution;
    }

    if (
      session.media.binding
      && session.media.element === resolution.element
    ) {
      session.media.resolution = resolution;
      return resolution;
    }

    const element = resolution.element;
    let binding = null;
    const listener = (event) => {
      if (
        isSessionMediaCurrent(session, binding)
        && event.currentTarget === element
      ) {
        const shouldForward = updateMediaEventState(session.media, event.type);
        if (shouldForward) {
          onEvent({ binding, event, session, video: element });
        }
      }
    };
    for (const eventName of SESSION_MEDIA_EVENTS) {
      element.addEventListener(eventName, listener);
    }
    const releaseListeners = () => {
      for (const eventName of SESSION_MEDIA_EVENTS) {
        element.removeEventListener(eventName, listener);
      }
    };

    binding = bindSessionMedia(session, element, releaseListeners);
    if (
      binding
      && session.media.element === element
      && isSessionMediaCurrent(session, binding)
    ) {
      session.media.resolution = resolution;
    }
    return resolution;
  }

  function updateMediaEventState(media, eventType) {
    if (eventType === "seeking") {
      media.seeking = true;
      media.ended = false;
      return true;
    }
    if (eventType === "seeked") {
      media.seeking = false;
      return true;
    }
    if (eventType === "ended") {
      if (media.ended) {
        return false;
      }
      media.seeking = false;
      media.ended = true;
      return true;
    }
    if (eventType === "play" || eventType === "loadedmetadata") {
      media.ended = false;
      return true;
    }
    if (eventType === "emptied") {
      media.seeking = false;
      media.ended = false;
    }
    return true;
  }

  function getReadySessionVideo(session) {
    const media = session?.media;
    const duration = Number(media?.element?.duration);
    const readyState = Number(media?.element?.readyState);
    if (
      !media?.binding
      || media.element?.isConnected === false
      || !Number.isFinite(duration)
      || duration <= 0
      || !Number.isFinite(readyState)
      || readyState < 1
      || media.resolution?.status !== VIDEO_RESOLUTION_STATUSES.READY
      || media.resolution.element !== media.element
      || !isSessionMediaCurrent(session, media.binding)
    ) {
      return null;
    }
    return media.element;
  }

  globalThis.TimestampPlayerSessionMedia = {
    SESSION_MEDIA_EVENTS,
    getReadySessionVideo,
    resolveAndBindSessionMedia,
  };
})();
