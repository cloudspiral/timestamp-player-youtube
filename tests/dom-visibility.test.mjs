import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadDomVisibility() {
  const source = await readFile(
    new URL("../src/dom-visibility.js", import.meta.url),
    "utf8"
  );
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return context.TimestampPlayerDomVisibility;
}

function element({ attributes = {}, hidden = false, inert = false, parentElement = null } = {}) {
  const values = new Map(Object.entries(attributes));
  return {
    getAttribute: (name) => values.get(name) ?? null,
    hasAttribute: (name) => values.has(name),
    hidden,
    inert,
    parentElement,
  };
}

test("explicit visibility walks hidden, inert, ARIA, and computed ancestor state", async () => {
  const { isElementTreeExplicitlyHidden } = await loadDomVisibility();
  const hiddenAncestor = element({ attributes: { "aria-hidden": "true" } });
  const child = element({ parentElement: hiddenAncestor });
  const inertChild = element({ parentElement: element({ inert: true }) });
  const hiddenAttribute = element({ attributes: { hidden: "" } });
  const styleAncestor = element();
  const styledChild = element({ parentElement: styleAncestor });

  assert.equal(isElementTreeExplicitlyHidden(child), true);
  assert.equal(isElementTreeExplicitlyHidden(inertChild), true);
  assert.equal(isElementTreeExplicitlyHidden(hiddenAttribute), true);
  assert.equal(isElementTreeExplicitlyHidden(styledChild, (candidate) => ({
    display: "block",
    visibility: candidate === styleAncestor ? "collapse" : "visible",
  })), true);
  assert.equal(isElementTreeExplicitlyHidden(element(), () => ({
    display: "block",
    visibility: "visible",
  })), false);
});

test("style lookup failures are not mistaken for hidden evidence", async () => {
  const { isElementTreeExplicitlyHidden } = await loadDomVisibility();

  assert.equal(isElementTreeExplicitlyHidden(element(), () => {
    throw new Error("detached style lookup");
  }), false);
});

test("the manifest loads shared visibility before DOM and media consumers", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../manifest.json", import.meta.url), "utf8")
  );
  const scripts = manifest.content_scripts[0].js;
  const visibilityIndex = scripts.indexOf("src/dom-visibility.js");

  assert.ok(visibilityIndex >= 0);
  assert.ok(visibilityIndex < scripts.indexOf("src/youtube-dom.js"));
  assert.ok(visibilityIndex < scripts.indexOf("src/video-resolver.js"));
});
