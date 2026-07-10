(() => {
  const SAVE_FAILURE_STATUS_DURATION_MS = 6000;
  const SAVE_SUCCESS_STATUS_DURATION_MS = 1600;
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
    },
    {
      input: progressCustomColorInput,
      colorSetting: "progressColor",
    },
  ];
  const statusEl = document.getElementById("save-status");
  let isInitialized = false;
  let pendingSaveRequest = null;
  let saveGeneration = 0;
  let saveInFlight = false;
  let saveTimer = null;

  function init() {
    setFormLoading(true);
    renderSegmentedControl("progressTimeMode", PROGRESS_TIME_MODES);
    renderSegmentedControl("compactProgressStyle", COMPACT_PROGRESS_STYLES);
    renderSwatchControl("trackHighlightColor", TRACK_HIGHLIGHT_COLORS);
    renderSwatchControl("compactProgressColor", COMPACT_PROGRESS_COLORS);
    renderSwatchControl("progressColor", COMPACT_PROGRESS_COLORS);

    loadSettings((settings) => {
      if (isInitialized) {
        return;
      }

      isInitialized = true;
      applySettings(settings);
      form.addEventListener("change", handleChange);
      setFormLoading(false);
    });
  }

  function setFormLoading(isLoading) {
    form.setAttribute("aria-busy", String(isLoading));
    if (isLoading) {
      form.setAttribute("inert", "");
      return;
    }

    form.removeAttribute("inert");
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
    clearStatus();
    const customColorInput = customColorInputs.find(({ input }) => input === event.target);
    if (customColorInput) {
      checkRadio(customColorInput.colorSetting, "custom");
      updateCustomColorPreview(customColorInput.colorSetting, customColorInput.input.value);
    }

    const generation = saveGeneration + 1;
    saveGeneration = generation;
    pendingSaveRequest = {
      generation,
      settings: readSettingsFromForm(),
    };
    flushPendingSave();
  }

  function flushPendingSave() {
    if (saveInFlight || !pendingSaveRequest) {
      return;
    }

    const request = pendingSaveRequest;
    pendingSaveRequest = null;
    saveInFlight = true;
    saveSettings(request.settings, (saved) => {
      saveInFlight = false;
      if (request.generation === saveGeneration && !pendingSaveRequest) {
        showStatus(
          saved ? "Saved" : "Could not save settings",
          saved ? "success" : "error",
          saved ? SAVE_SUCCESS_STATUS_DURATION_MS : SAVE_FAILURE_STATUS_DURATION_MS
        );
      }
      flushPendingSave();
    });
  }

  function updateCustomColorPreview(settingName, color) {
    const customSwatch = form.querySelector(`input[name='${settingName}'][value='custom'] + .swatch`);
    customSwatch?.style.setProperty("--swatch-color", color);
  }

  function showStatus(message, status, duration) {
    clearStatus();
    statusEl.textContent = message;
    statusEl.setAttribute("data-status", status);
    saveTimer = window.setTimeout(() => {
      clearStatus();
    }, duration);
  }

  function clearStatus() {
    window.clearTimeout(saveTimer);
    saveTimer = null;
    statusEl.textContent = "";
    statusEl.removeAttribute("data-status");
  }

  init();
})();
