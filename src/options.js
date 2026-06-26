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
  const compactProgressCustomColorInput = document.getElementById("compact-progress-custom-color");
  const progressCustomColorInput = document.getElementById("progress-custom-color");
  const customColorInputs = [
    {
      input: compactProgressCustomColorInput,
      colorSetting: "compactProgressColor",
      customSetting: "compactProgressCustomColor",
    },
    {
      input: progressCustomColorInput,
      colorSetting: "progressColor",
      customSetting: "progressCustomColor",
    },
  ];
  const statusEl = document.getElementById("save-status");
  let saveTimer = null;

  function init() {
    renderSegmentedControl("progressTimeMode", PROGRESS_TIME_MODES);
    renderSegmentedControl("compactProgressStyle", COMPACT_PROGRESS_STYLES);
    renderSwatchControl("trackHighlightColor", TRACK_HIGHLIGHT_COLORS);
    renderSwatchControl("compactProgressColor", COMPACT_PROGRESS_COLORS);
    renderSwatchControl("progressColor", COMPACT_PROGRESS_COLORS);

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

    root.replaceChildren(
      ...Object.entries(choices).map(([value, choice]) => {
        const label = document.createElement("label");
        const input = document.createElement("input");
        const text = document.createElement("span");

        input.type = "radio";
        input.name = settingName;
        input.value = value;
        text.textContent = choice.label;

        label.append(input, text);
        return label;
      })
    );
  }

  function renderSwatchControl(settingName, choices) {
    const root = document.querySelector(`[data-setting="${settingName}"]`);
    if (!root) {
      return;
    }

    root.replaceChildren(
      ...Object.entries(choices).map(([value, choice]) => {
        const label = document.createElement("label");
        const input = document.createElement("input");
        const swatch = document.createElement("span");
        const screenReaderLabel = document.createElement("span");

        label.title = choice.label;

        input.type = "radio";
        input.name = settingName;
        input.value = value;
        input.setAttribute("aria-label", choice.label);

        swatch.className = "swatch";
        swatch.style.setProperty("--swatch-color", choice.swatch);

        screenReaderLabel.className = "sr-only";
        screenReaderLabel.textContent = choice.label;

        label.append(input, swatch, screenReaderLabel);
        return label;
      })
    );
  }

  function applySettings(settings) {
    autoShowInput.checked = settings.autoShowCompact;
    checkRadio("progressTimeMode", settings.progressTimeMode);
    checkRadio("compactProgressStyle", settings.compactProgressStyle);
    checkRadio("trackHighlightColor", settings.trackHighlightColor);
    checkRadio("compactProgressColor", settings.compactProgressColor);
    checkRadio("progressColor", settings.progressColor);
    compactProgressCustomColorInput.value = settings.compactProgressCustomColor;
    progressCustomColorInput.value = settings.progressCustomColor;
    updateCustomColorPreview("compactProgressColor", settings.compactProgressCustomColor);
    updateCustomColorPreview("progressColor", settings.progressCustomColor);
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
      compactProgressCustomColor: formData.get("compactProgressCustomColor"),
      progressColor: formData.get("progressColor"),
      progressCustomColor: formData.get("progressCustomColor"),
      progressTimeMode: formData.get("progressTimeMode"),
      trackHighlightColor: formData.get("trackHighlightColor"),
    };
  }

  function handleChange(event) {
    const customColorInput = customColorInputs.find(({ input }) => input === event.target);
    if (customColorInput) {
      checkRadio(customColorInput.colorSetting, "custom");
      updateCustomColorPreview(customColorInput.colorSetting, customColorInput.input.value);
    }

    saveSettings(readSettingsFromForm(), (saved) => {
      showStatus(saved ? "Saved" : "Could not save settings");
    });
  }

  function updateCustomColorPreview(settingName, color) {
    const customSwatch = form.querySelector(`input[name='${settingName}'][value='custom'] + .swatch`);
    customSwatch?.style.setProperty("--swatch-color", color);
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
