(() => {
  function isElementTreeExplicitlyHidden(
    element,
    getComputedStyleFn = globalThis.getComputedStyle
  ) {
    for (let current = element; current; current = current.parentElement) {
      if (
        current.hidden === true
        || current.inert === true
        || current.hasAttribute?.("hidden") === true
        || current.hasAttribute?.("inert") === true
        || current.getAttribute?.("aria-hidden") === "true"
      ) {
        return true;
      }

      if (typeof getComputedStyleFn !== "function") {
        continue;
      }
      try {
        const style = getComputedStyleFn(current);
        if (
          style?.display === "none"
          || style?.visibility === "hidden"
          || style?.visibility === "collapse"
        ) {
          return true;
        }
      } catch (_error) {
        // A transient or test-only style lookup failure is not hidden evidence.
      }
    }
    return false;
  }

  globalThis.TimestampPlayerDomVisibility = {
    isElementTreeExplicitlyHidden,
  };
})();
