(() => {
  const DEFAULT_SETTINGS = {
    autoShowCompact: false,
    compactProgressColor: "red",
    compactProgressCustomColor: "#ff0033",
    compactProgressStyle: "subtle",
    progressColor: "red",
    progressCustomColor: "#ff0033",
    progressTimeMode: "duration",
    trackHighlightColor: "purple",
  };

  const COMPACT_PROGRESS_STYLES = {
    subtle: {
      label: "Subtle",
      height: "1px",
      opacity: "0.75",
    },
    normal: {
      label: "Normal",
      height: "2px",
      opacity: "1",
    },
  };

  const PROGRESS_TIME_MODES = {
    duration: {
      label: "Track duration",
    },
    remaining: {
      label: "Time remaining",
    },
  };

  const COMPACT_PROGRESS_COLORS = {
    red: {
      label: "Red",
      color: "#ff0033",
      swatch: "#ff0033",
    },
    white: {
      label: "White",
      color: "rgba(255, 255, 255, 0.78)",
      swatch: "#d8d8d8",
    },
    green: {
      label: "Green",
      color: "#32c982",
      swatch: "#32c982",
    },
    purple: {
      label: "Purple",
      color: "#a681ff",
      swatch: "#a681ff",
    },
    custom: {
      label: "Custom",
      color: null,
      swatch: "#ff0033",
    },
  };

  const TRACK_HIGHLIGHT_COLORS = {
    red: {
      label: "Red",
      bg: "rgba(255, 0, 51, 0.24)",
      hoverBg: "rgba(255, 0, 51, 0.32)",
      text: "#ffc2cc",
      swatch: "#ff0033",
    },
    orange: {
      label: "Orange",
      bg: "rgba(247, 147, 26, 0.24)",
      hoverBg: "rgba(247, 147, 26, 0.32)",
      text: "#ffd7a6",
      swatch: "#f7931a",
    },
    green: {
      label: "Green",
      bg: "rgba(50, 201, 130, 0.24)",
      hoverBg: "rgba(50, 201, 130, 0.32)",
      text: "#bff3d8",
      swatch: "#32c982",
    },
    cyan: {
      label: "Cyan",
      bg: "rgba(0, 188, 255, 0.22)",
      hoverBg: "rgba(0, 188, 255, 0.30)",
      text: "#bdeeff",
      swatch: "#00bcff",
    },
    blue: {
      label: "Blue",
      bg: "rgba(42, 130, 255, 0.26)",
      hoverBg: "rgba(42, 130, 255, 0.34)",
      text: "#c9dcff",
      swatch: "#2a82ff",
    },
    purple: {
      label: "Purple",
      bg: "rgba(126, 87, 194, 0.34)",
      hoverBg: "rgba(126, 87, 194, 0.42)",
      text: "#d7c8ff",
      swatch: "#7e57c2",
    },
    pink: {
      label: "Pink",
      bg: "rgba(255, 79, 163, 0.24)",
      hoverBg: "rgba(255, 79, 163, 0.32)",
      text: "#ffc4df",
      swatch: "#ff4fa3",
    },
    grey: {
      label: "Grey",
      bg: "rgba(148, 154, 164, 0.22)",
      hoverBg: "rgba(148, 154, 164, 0.30)",
      text: "#e2e5ea",
      swatch: "#8f96a3",
    },
  };

  function normalizeSettings(settings = {}) {
    const normalized = { ...DEFAULT_SETTINGS };

    normalized.autoShowCompact = settings.autoShowCompact === true;

    if (Object.hasOwn(COMPACT_PROGRESS_STYLES, settings.compactProgressStyle)) {
      normalized.compactProgressStyle = settings.compactProgressStyle;
    }

    if (Object.hasOwn(COMPACT_PROGRESS_COLORS, settings.compactProgressColor)) {
      normalized.compactProgressColor = settings.compactProgressColor;
    }

    if (isHexColor(settings.compactProgressCustomColor)) {
      normalized.compactProgressCustomColor = settings.compactProgressCustomColor.toLowerCase();
    }

    if (Object.hasOwn(COMPACT_PROGRESS_COLORS, settings.progressColor)) {
      normalized.progressColor = settings.progressColor;
    }

    if (isHexColor(settings.progressCustomColor)) {
      normalized.progressCustomColor = settings.progressCustomColor.toLowerCase();
    }

    if (Object.hasOwn(PROGRESS_TIME_MODES, settings.progressTimeMode)) {
      normalized.progressTimeMode = settings.progressTimeMode;
    }

    if (Object.hasOwn(TRACK_HIGHLIGHT_COLORS, settings.trackHighlightColor)) {
      normalized.trackHighlightColor = settings.trackHighlightColor;
    }

    return normalized;
  }

  function isHexColor(value) {
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
  }

  function getStorageArea() {
    return globalThis.chrome?.storage?.local || null;
  }

  function loadSettings(callback) {
    const storage = getStorageArea();
    if (!storage) {
      callback({ ...DEFAULT_SETTINGS });
      return;
    }

    storage.get(DEFAULT_SETTINGS, (items) => {
      if (globalThis.chrome?.runtime?.lastError) {
        callback({ ...DEFAULT_SETTINGS });
        return;
      }

      callback(normalizeSettings(items));
    });
  }

  function saveSettings(partialSettings, callback = () => {}) {
    const storage = getStorageArea();
    if (!storage) {
      callback(false);
      return;
    }

    const normalized = normalizeSettings({ ...DEFAULT_SETTINGS, ...partialSettings });
    const payload = {};
    for (const key of Object.keys(partialSettings)) {
      if (Object.hasOwn(DEFAULT_SETTINGS, key)) {
        payload[key] = normalized[key];
      }
    }

    storage.set(payload, () => {
      callback(!globalThis.chrome?.runtime?.lastError);
    });
  }

  globalThis.TimestampPlayerSettings = {
    COMPACT_PROGRESS_COLORS,
    COMPACT_PROGRESS_STYLES,
    DEFAULT_SETTINGS,
    PROGRESS_TIME_MODES,
    TRACK_HIGHLIGHT_COLORS,
    loadSettings,
    normalizeSettings,
    saveSettings,
  };
})();
