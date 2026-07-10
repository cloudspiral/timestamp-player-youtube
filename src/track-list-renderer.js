(() => {
  function createTrackListRenderer({
    document,
    formatTimestamp,
    formatTrackLabel,
    listElement,
  }) {
    if (!document || !listElement || !formatTimestamp || !formatTrackLabel) {
      throw new TypeError("Track list renderer dependencies are required");
    }

    let activeIndex = -1;
    let collectionSignature = null;
    let enabled = true;
    let renderedTracks = null;
    let rowsByKey = new Map();

    function renderCollection(tracks = []) {
      if (tracks === renderedTracks) {
        return false;
      }

      const descriptors = describeTracks(tracks, formatTrackLabel, formatTimestamp);
      const nextSignature = descriptors.map(({ signature }) => signature).join("\n");
      renderedTracks = tracks;
      if (nextSignature === collectionSignature) {
        return false;
      }

      const nextRows = new Map();
      for (const [position, descriptor] of descriptors.entries()) {
        const row = rowsByKey.get(descriptor.key) || createTrackRow(document);
        updateTrackRow(row, descriptor);
        setRowEnabled(row, enabled);
        setRowActive(row, descriptor.index === activeIndex);
        nextRows.set(descriptor.key, row);

        const currentAtPosition = listElement.children[position] || null;
        if (currentAtPosition !== row.item) {
          listElement.insertBefore(row.item, currentAtPosition);
        }
      }

      for (const [key, row] of rowsByKey) {
        if (!nextRows.has(key)) {
          row.item.remove();
        }
      }

      rowsByKey = nextRows;
      collectionSignature = nextSignature;
      return true;
    }

    function renderEnabled(nextEnabled = true) {
      const normalizedEnabled = Boolean(nextEnabled);
      if (normalizedEnabled === enabled) {
        return false;
      }

      enabled = normalizedEnabled;
      for (const row of rowsByKey.values()) {
        setRowEnabled(row, enabled);
      }
      return true;
    }

    function renderActive(nextActiveIndex) {
      const normalizedIndex = Number.isInteger(nextActiveIndex) ? nextActiveIndex : -1;
      if (normalizedIndex === activeIndex) {
        return false;
      }

      const previousIndex = activeIndex;
      activeIndex = normalizedIndex;
      for (const row of rowsByKey.values()) {
        if (row.trackIndex === previousIndex || row.trackIndex === activeIndex) {
          setRowActive(row, row.trackIndex === activeIndex);
        }
      }
      return true;
    }

    function getRowForIndex(index) {
      for (const row of rowsByKey.values()) {
        if (row.trackIndex === index) {
          return row.item;
        }
      }
      return null;
    }

    function clear() {
      for (const row of rowsByKey.values()) {
        row.item.remove();
      }
      activeIndex = -1;
      collectionSignature = null;
      renderedTracks = null;
      rowsByKey = new Map();
    }

    return {
      clear,
      getRowForIndex,
      renderActive,
      renderCollection,
      renderEnabled,
    };
  }

  function describeTracks(tracks, formatTrackLabel, formatTimestamp) {
    const keyOccurrences = new Map();
    return tracks.map((track, index) => {
      const startKey = String(track.start);
      const occurrence = keyOccurrences.get(startKey) || 0;
      keyOccurrences.set(startKey, occurrence + 1);
      const key = occurrence === 0 ? startKey : `${startKey}:${occurrence}`;
      const label = formatTrackLabel(track);
      const time = formatTimestamp(track.start);
      const trackIndex = Number.isInteger(track.index) ? track.index : index;
      return {
        index: trackIndex,
        key,
        label,
        signature: `${key}\u0000${trackIndex}\u0000${track.end}\u0000${label}\u0000${time}`,
        time,
      };
    });
  }

  function createTrackRow(document) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "ts-list-item";

    const number = document.createElement("span");
    number.className = "ts-list-number";

    const title = document.createElement("span");
    title.className = "ts-list-title";

    const time = document.createElement("span");
    time.className = "ts-list-time";

    item.append(number, title, time);
    return {
      item,
      number,
      time,
      title,
      trackIndex: -1,
    };
  }

  function updateTrackRow(row, descriptor) {
    row.trackIndex = descriptor.index;
    row.item.dataset.index = String(descriptor.index);
    row.item.title = descriptor.label;
    row.number.textContent = String(descriptor.index + 1);
    row.title.textContent = descriptor.label;
    row.title.title = descriptor.label;
    row.time.textContent = descriptor.time;
  }

  function setRowActive(row, active) {
    row.item.classList.toggle("is-active", active);
    if (active) {
      row.item.setAttribute("aria-current", "true");
    } else {
      row.item.removeAttribute("aria-current");
    }
  }

  function setRowEnabled(row, enabled) {
    row.item.disabled = !enabled;
  }

  globalThis.TimestampPlayerTrackListRenderer = {
    createTrackListRenderer,
  };
})();
