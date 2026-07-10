(() => {
  const DEFAULT_TTL_MS = Infinity;
  const DEFAULT_MAX_ENTRIES = 20;

  function createLruCache({
    maxEntries = DEFAULT_MAX_ENTRIES,
    now = Date.now,
    ttlMs = DEFAULT_TTL_MS,
  } = {}) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new TypeError("LRU cache maxEntries must be a positive integer");
    }
    if ((ttlMs !== Infinity && !Number.isFinite(ttlMs)) || ttlMs <= 0) {
      throw new TypeError("LRU cache ttlMs must be a positive number or Infinity");
    }
    if (typeof now !== "function") {
      throw new TypeError("LRU cache now must be a function");
    }

    const entries = new Map();
    const expiresAt = (currentTime) => currentTime + ttlMs;

    function getCurrentTime() {
      const currentTime = now();
      if (!Number.isFinite(currentTime) || currentTime < 0) {
        throw new TypeError("LRU cache now must return a finite non-negative number");
      }
      return currentTime;
    }

    function deleteIfExpired(key, entry, currentTime = getCurrentTime()) {
      if (!entry || currentTime < entry.expiresAt) {
        return false;
      }
      entries.delete(key);
      return true;
    }

    function pruneExpired(currentTime = getCurrentTime()) {
      for (const [key, entry] of entries) {
        deleteIfExpired(key, entry, currentTime);
      }
    }

    const cache = {
      clear() {
        entries.clear();
      },

      delete(key) {
        return entries.delete(key);
      },

      get(key) {
        const entry = entries.get(key);
        const currentTime = getCurrentTime();
        if (!entry || deleteIfExpired(key, entry, currentTime)) {
          return undefined;
        }

        entries.delete(key);
        entries.set(key, entry);
        return entry.value;
      },

      has(key) {
        const entry = entries.get(key);
        return Boolean(entry && !deleteIfExpired(key, entry));
      },

      set(key, value) {
        const currentTime = getCurrentTime();
        pruneExpired(currentTime);
        if (entries.has(key)) {
          entries.delete(key);
        }
        entries.set(key, {
          expiresAt: expiresAt(currentTime),
          value,
        });

        if (entries.size > maxEntries) {
          const oldestKey = entries.keys().next().value;
          entries.delete(oldestKey);
        }
        return cache;
      },
    };

    Object.defineProperty(cache, "size", {
      enumerable: true,
      get: () => {
        pruneExpired();
        return entries.size;
      },
    });

    return Object.freeze(cache);
  }

  globalThis.TimestampPlayerLruCache = {
    DEFAULT_MAX_ENTRIES,
    DEFAULT_TTL_MS,
    createLruCache,
  };
})();
