import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { preparePackageSources } from "../scripts/prepare-package-sources.mjs";
import { verifyPackageSources } from "../scripts/verify-package-sources.mjs";

const manifest = {
  manifest_version: 3,
  name: "Package fixture",
  version: "1.0.0",
  options_page: "options.html",
  browser_specific_settings: {
    gecko: { id: "fixture@example.test" },
  },
  icons: { 16: "icons/icon.png" },
  content_scripts: [{
    matches: ["https://example.test/*"],
    js: ["src/content.js"],
    css: ["src/content.css"],
  }],
};

const runtimeFiles = new Map([
  ["LICENSE", "fixture license\n"],
  ["icons/icon.png", "fixture icon\n"],
  ["options.html", `<!doctype html>
<link rel="stylesheet" href="src/options.css">
<script src="src/options.js"></script>
`],
  ["src/content.css", ".fixture { display: block; }\n"],
  ["src/content.js", "(() => {})();\n"],
  ["src/options.css", ".options { display: block; }\n"],
  ["src/options.js", "(() => {})();\n"],
]);

async function createSourceFixture(t) {
  const rootDir = await mkdtemp(path.join(tmpdir(), "timestamp-player-prepare-"));
  t.after(() => rm(rootDir, { force: true, recursive: true }));
  await writeProjectFile(rootDir, "manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  await Promise.all([...runtimeFiles].map(([relativePath, contents]) => {
    return writeProjectFile(rootDir, relativePath, contents);
  }));
  return rootDir;
}

async function writeProjectFile(rootDir, relativePath, contents) {
  const filename = path.join(rootDir, ...relativePath.split("/"));
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, contents);
  return filename;
}

test("prepares exact Chrome and Firefox runtime trees that pass verification", async (t) => {
  const rootDir = await createSourceFixture(t);

  const prepared = await preparePackageSources({ rootDir });
  const verified = await verifyPackageSources({ rootDir });
  const chromeManifest = JSON.parse(
    await readFile(path.join(rootDir, "dist", "chrome", "manifest.json"), "utf8")
  );
  const firefoxManifest = JSON.parse(
    await readFile(path.join(rootDir, "dist", "firefox", "manifest.json"), "utf8")
  );

  assert.deepEqual(prepared.targets, ["chrome", "firefox"]);
  assert.equal(prepared.runtimeFileCount, runtimeFiles.size);
  assert.equal(Object.hasOwn(chromeManifest, "browser_specific_settings"), false);
  assert.deepEqual(
    firefoxManifest.browser_specific_settings,
    manifest.browser_specific_settings
  );
  assert.equal(verified.targets.chrome.runtimeFileCount, runtimeFiles.size + 1);
  assert.equal(verified.targets.firefox.runtimeFileCount, runtimeFiles.size + 1);
  for (const [relativePath, expected] of runtimeFiles) {
    assert.equal(
      await readFile(
        path.join(rootDir, "dist", "chrome", ...relativePath.split("/")),
        "utf8"
      ),
      expected,
      relativePath
    );
  }
});

test("preparation rejects a symbolic link in the runtime source tree", async (t) => {
  const rootDir = await createSourceFixture(t);
  await symlink(
    path.join(rootDir, "src", "content.js"),
    path.join(rootDir, "src", "linked.js")
  );

  await assert.rejects(
    preparePackageSources({ rootDir }),
    /Runtime package source must not be a symbolic link: src\/linked\.js/
  );
});

test("preparation rejects a linked output root without touching its target", async (t) => {
  const rootDir = await createSourceFixture(t);
  const outsideDirectory = await mkdtemp(path.join(tmpdir(), "timestamp-player-outside-"));
  t.after(() => rm(outsideDirectory, { force: true, recursive: true }));
  const sentinelPath = await writeProjectFile(
    outsideDirectory,
    "chrome/sentinel.txt",
    "preserve me\n"
  );
  await symlink(outsideDirectory, path.join(rootDir, "dist"));

  await assert.rejects(
    preparePackageSources({ rootDir }),
    /Package output root must be a real directory/
  );
  assert.equal(await readFile(sentinelPath, "utf8"), "preserve me\n");
});
