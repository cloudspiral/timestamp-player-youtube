(() => {
  const {
    COMPACT_PROGRESS_COLORS,
    COMPACT_PROGRESS_STYLES,
    PROGRESS_TIME_MODES,
    TRACK_HIGHLIGHT_COLORS,
    loadSettings,
    saveSettings,
  } = globalThis.TimestampPlayerSettings;

  const form = document.getElementById("settings-form");
  const autoShowInput = document.getElementById("auto-show-compact");
  const statusEl = document.getElementById("save-status");
  let saveTimer = null;

  function init() {
    renderSegmentedControl("progressTimeMode", PROGRESS_TIME_MODES);
    renderSegmentedControl("compactProgressStyle", COMPACT_PROGRESS_STYLES);
    renderSwatchControl("trackHighlightColor", TRACK_HIGHLIGHT_COLORS);
    renderSwatchControl("compactProgressColor", COMPACT_PROGRESS_COLORS);

    loadSettings((settings) => {
      applySettings(settings);
      form.addEventListener("change", handleChange);
    });
  }

  function renderSegmentedControl(settingName, choices) {
    const root = document.querySelector(`[data-setting="${settingName}"]`);
    if (!root) {
      return;
    }

    root.innerHTML = Object.entries(choices)
      .map(([value, choice]) => {
        return `
          <label>
            <input type="radio" name="${settingName}" value="${value}">
            <span>${choice.label}</span>
          </label>
        `;
      })
      .join("");
  }

  function renderSwatchControl(settingName, choices) {
    const root = document.querySelector(`[data-setting="${settingName}"]`);
    if (!root) {
      return;
    }

    root.innerHTML = Object.entries(choices)
      .map(([value, choice]) => {
        return `
          <label>
            <input type="radio" name="${settingName}" value="${value}">
            <span class="swatch" style="--swatch-color: ${choice.swatch}"></span>
            <span>${choice.label}</span>
          </label>
        `;
      })
      .join("");
  }

  function applySettings(settings) {
    autoShowInput.checked = settings.autoShowCompact;
    checkRadio("progressTimeMode", settings.progressTimeMode);
    checkRadio("compactProgressStyle", settings.compactProgressStyle);
    checkRadio("trackHighlightColor", settings.trackHighlightColor);
    checkRadio("compactProgressColor", settings.compactProgressColor);
  }

  function checkRadio(name, value) {
    const input = form.querySelector(`input[name="${name}"][value="${value}"]`);
    if (input) {
      input.checked = true;
    }
  }

  function readSettingsFromForm() {
    const formData = new FormData(form);
    return {
      autoShowCompact: autoShowInput.checked,
      compactProgressStyle: formData.get("compactProgressStyle"),
      compactProgressColor: formData.get("compactProgressColor"),
      progressTimeMode: formData.get("progressTimeMode"),
      trackHighlightColor: formData.get("trackHighlightColor"),
    };
  }

  function handleChange() {
    saveSettings(readSettingsFromForm(), (saved) => {
      showStatus(saved ? "Saved" : "Could not save settings");
    });
  }

  function showStatus(message) {
    statusEl.textContent = message;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      statusEl.textContent = "";
    }, 1600);
  }

  init();
})();
