import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadLruCache() {
  const source = await readFile(new URL("../src/lru-cache.js", import.meta.url), "utf8");
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return context.TimestampPlayerLruCache;
}

test("validates a small positive integer capacity", async () => {
  const { DEFAULT_MAX_ENTRIES, DEFAULT_TTL_MS, createLruCache } = await loadLruCache();

  assert.equal(DEFAULT_MAX_ENTRIES, 20);
  assert.equal(DEFAULT_TTL_MS, Infinity);
  for (const maxEntries of [0, -1, 1.5, NaN, Infinity, "2", null]) {
    assert.throws(
      () => createLruCache({ maxEntries }),
      /positive integer/
    );
  }
  for (const ttlMs of [0, -1, NaN, "1000", null]) {
    assert.throws(
      () => createLruCache({ ttlMs }),
      /positive number or Infinity/
    );
  }
  assert.throws(() => createLruCache({ now: 1 }), /now must be a function/);
  for (const currentTime of [-1, NaN, Infinity]) {
    const cache = createLruCache({ now: () => currentTime });
    assert.throws(
      () => cache.set("invalid-clock", true),
      /finite non-negative number/
    );
  }
  assert.equal(createLruCache({ maxEntries: 1 }).size, 0);
  assert.equal(createLruCache().size, 0);
});

test("provides minimal Map-like get, set, has, delete, clear, and size behavior", async () => {
  const { createLruCache } = await loadLruCache();
  const cache = createLruCache({ maxEntries: 3 });

  assert.equal(cache.size, 0);
  assert.equal(cache.has("album"), false);
  assert.equal(cache.get("album"), undefined);
  assert.equal(cache.set("album", ["track"]), cache, "set remains chainable like Map#set");
  assert.equal(cache.size, 1);
  assert.equal(cache.has("album"), true);
  assert.deepEqual(cache.get("album"), ["track"]);
  assert.equal(cache.delete("missing"), false);
  assert.equal(cache.delete("album"), true);
  assert.equal(cache.size, 0);

  cache.set("a", 1).set("b", 2);
  assert.equal(cache.size, 2);
  assert.equal(cache.clear(), undefined);
  assert.equal(cache.size, 0);
});

test("evicts the oldest entry deterministically when capacity is exceeded", async () => {
  const { createLruCache } = await loadLruCache();
  const cache = createLruCache({ maxEntries: 3 });

  cache.set("a", 1).set("b", 2).set("c", 3).set("d", 4);

  assert.equal(cache.has("a"), false);
  assert.equal(cache.has("b"), true);
  assert.equal(cache.has("c"), true);
  assert.equal(cache.has("d"), true);
  assert.equal(cache.size, 3);
});

test("successful get refreshes recency without changing size", async () => {
  const { createLruCache } = await loadLruCache();
  const cache = createLruCache({ maxEntries: 3 });
  cache.set("a", 1).set("b", 2).set("c", 3);

  assert.equal(cache.get("a"), 1);
  assert.equal(cache.size, 3);
  cache.set("d", 4);

  assert.equal(cache.has("a"), true);
  assert.equal(cache.has("b"), false, "b became oldest after a was read");
});

test("updating an existing key refreshes recency and never grows the cache", async () => {
  const { createLruCache } = await loadLruCache();
  const cache = createLruCache({ maxEntries: 3 });
  cache.set("a", 1).set("b", 2).set("c", 3);

  cache.set("a", 10);
  assert.equal(cache.size, 3);
  assert.equal(cache.get("a"), 10);
  cache.set("d", 4);

  assert.equal(cache.has("b"), false);
  assert.equal(cache.has("a"), true);
});

test("has and failed reads do not unexpectedly refresh recency", async () => {
  const { createLruCache } = await loadLruCache();
  const cache = createLruCache({ maxEntries: 3 });
  cache.set("a", 1).set("b", 2).set("c", 3);

  assert.equal(cache.has("a"), true);
  assert.equal(cache.get("missing"), undefined);
  assert.equal(cache.delete("missing"), false);
  cache.set("d", 4);

  assert.equal(cache.has("a"), false, "observational operations must leave a oldest");
  assert.equal(cache.has("b"), true);
});

test("stored undefined remains distinguishable through has", async () => {
  const { createLruCache } = await loadLruCache();
  const cache = createLruCache({ maxEntries: 2 });

  cache.set("undefined-value", undefined);
  assert.equal(cache.get("undefined-value"), undefined);
  assert.equal(cache.has("undefined-value"), true);
  assert.equal(cache.has("missing"), false);
});

test("capacity one always retains only the most recently set or read entry", async () => {
  const { createLruCache } = await loadLruCache();
  const cache = createLruCache({ maxEntries: 1 });

  cache.set("a", 1).set("b", 2);
  assert.equal(cache.has("a"), false);
  assert.equal(cache.get("b"), 2);
  cache.set("c", 3);
  assert.equal(cache.has("b"), false);
  assert.equal(cache.get("c"), 3);
  assert.equal(cache.size, 1);
});

test("uses Map key identity and returns stored values without cloning or mutation", async () => {
  const { createLruCache } = await loadLruCache();
  const cache = createLruCache({ maxEntries: 2 });
  const key = { videoId: "album" };
  const equalButDistinctKey = { videoId: "album" };
  const value = { tracks: [1, 2] };

  cache.set(key, value);
  assert.equal(cache.get(key), value);
  assert.equal(cache.has(equalButDistinctKey), false);
  assert.deepEqual(value, { tracks: [1, 2] });
});

test("entries expire at the absolute TTL boundary and disappear from size", async () => {
  const { createLruCache } = await loadLruCache();
  let currentTime = 100;
  const cache = createLruCache({
    maxEntries: 3,
    now: () => currentTime,
    ttlMs: 50,
  });

  cache.set("album", { tracks: [1] });
  currentTime = 149;
  assert.equal(cache.has("album"), true);
  currentTime = 150;
  assert.equal(cache.has("album"), false);
  assert.equal(cache.get("album"), undefined);
  assert.equal(cache.size, 0);
});

test("successful reads refresh recency without extending absolute expiration", async () => {
  const { createLruCache } = await loadLruCache();
  let currentTime = 0;
  const cache = createLruCache({
    maxEntries: 2,
    now: () => currentTime,
    ttlMs: 10,
  });

  cache.set("active", 1);
  currentTime = 9;
  assert.equal(cache.get("active"), 1);
  currentTime = 10;
  assert.equal(cache.has("active"), false);
  assert.equal(cache.size, 0);
});

test("setting an existing key refreshes its absolute expiration", async () => {
  const { createLruCache } = await loadLruCache();
  let currentTime = 0;
  const cache = createLruCache({
    maxEntries: 2,
    now: () => currentTime,
    ttlMs: 10,
  });

  cache.set("active", 1);
  currentTime = 9;
  cache.set("active", 2);
  currentTime = 10;
  assert.equal(cache.get("active"), 2);
  currentTime = 18;
  assert.equal(cache.has("active"), true);
  currentTime = 19;
  assert.equal(cache.has("active"), false);
});

test("setting a new value prunes expired entries before applying capacity eviction", async () => {
  const { createLruCache } = await loadLruCache();
  let currentTime = 0;
  const cache = createLruCache({
    maxEntries: 2,
    now: () => currentTime,
    ttlMs: 5,
  });

  cache.set("expired", 1);
  currentTime = 4;
  cache.set("recent", 2);
  currentTime = 5;
  cache.set("new", 3);

  assert.equal(cache.has("expired"), false);
  assert.equal(cache.has("recent"), true);
  assert.equal(cache.has("new"), true);
  assert.equal(cache.size, 2);
});
