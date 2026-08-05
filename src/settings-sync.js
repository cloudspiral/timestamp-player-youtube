(() => {
  const {
    DEFAULT_SETTINGS,
  } = globalThis.TimestampPlayerSettings;

  function createSettingsSyncController({
    applySettings,
    getSettings,
    load,
    subscribe,
  } = {}) {
    if (
      typeof applySettings !== "function"
      || typeof getSettings !== "function"
      || typeof load !== "function"
      || typeof subscribe !== "function"
    ) {
      throw new TypeError("Settings sync dependencies are required");
    }

    let activeGeneration = 0;
    let unsubscribe = null;

    function start() {
      stop();
      const generation = activeGeneration;
      const changesDuringLoad = {};
      let loadPending = true;
      let loadSettled = false;

      unsubscribe = subscribe((changes) => {
        if (generation !== activeGeneration) {
          return;
        }

        const patch = getKnownSettingsPatch(changes);
        if (Object.keys(patch).length === 0) {
          return;
        }
        if (loadPending) {
          Object.assign(changesDuringLoad, patch);
        }
        applySettings({ ...getSettings(), ...patch });
      });

      load((settings) => {
        if (generation !== activeGeneration || loadSettled) {
          return;
        }

        loadPending = false;
        loadSettled = true;
        applySettings({ ...settings, ...changesDuringLoad });
      });
    }

    function stop() {
      activeGeneration += 1;
      const cleanup = unsubscribe;
      unsubscribe = null;
      cleanup?.();
    }

    return Object.freeze({ start, stop });
  }

  function getKnownSettingsPatch(changes) {
    const patch = {};
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (Object.hasOwn(changes || {}, key)) {
        patch[key] = changes[key]?.newValue;
      }
    }
    return patch;
  }

  globalThis.TimestampPlayerSettingsSync = {
    createSettingsSyncController,
  };
})();
