import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  collectManifestAssetPaths,
  collectOptionAssetPaths,
  verifyPackageSources,
} from "../scripts/verify-package-sources.mjs";

const sourceManifest = {
  manifest_version: 3,
  name: "Fixture extension",
  version: "1.0.0",
  options_page: "options.html",
  browser_specific_settings: {
    gecko: {
      id: "fixture@example.test",
    },
  },
  icons: {
    16: "icons/icon.png",
  },
  content_scripts: [
    {
      matches: ["https://example.test/*"],
      js: ["src/content.js"],
      css: ["src/content.css"],
    },
  ],
};

const optionsHtml = `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="src/options.css?theme=default">
  </head>
  <body>
    <img src="./icons/icon.png" alt="">
    <script src='src/options.js'></script>
    <script src="https://example.test/external.js"></script>
  </body>
</html>
`;
const runtimeAssets = new Map([
  ["LICENSE", "fixture license\n"],
  ["options.html", optionsHtml],
  ["icons/icon.png", "fixture icon bytes\n"],
  ["src/content.css", ".fixture { display: block; }\n"],
  ["src/content.js", "(() => {})();\n"],
  ["src/options.css", ".options { color: black; }\n"],
  ["src/options.js", "(() => {})();\n"],
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function writeJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeAsset(filename, contents = "fixture\n") {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, contents);
}

async function createFixture(t) {
  const rootDir = await mkdtemp(path.join(tmpdir(), "timestamp-player-package-"));
  t.after(() => rm(rootDir, { force: true, recursive: true }));
  await writeJson(path.join(rootDir, "manifest.json"), sourceManifest);
  await Promise.all([...runtimeAssets].map(([assetPath, contents]) => {
    return writeAsset(path.join(rootDir, ...assetPath.split("/")), contents);
  }));

  for (const target of ["chrome", "firefox"]) {
    const targetDir = path.join(rootDir, "dist", target);
    const manifest = clone(sourceManifest);
    if (target === "chrome") {
      delete manifest.browser_specific_settings;
    }
    await writeJson(path.join(targetDir, "manifest.json"), manifest);
    await Promise.all([...runtimeAssets].map(([assetPath, contents]) => {
      return writeAsset(path.join(targetDir, ...assetPath.split("/")), contents);
    }));
  }
  return rootDir;
}

test("valid generated packages verify every manifest and options-page asset", async (t) => {
  const rootDir = await createFixture(t);

  assert.deepEqual(collectManifestAssetPaths(sourceManifest), [
    "icons/icon.png",
    "options.html",
    "src/content.css",
    "src/content.js",
  ]);
  assert.deepEqual(collectOptionAssetPaths(optionsHtml), [
    "icons/icon.png",
    "src/options.css",
    "src/options.js",
  ]);

  const report = await verifyPackageSources({ rootDir });
  assert.equal(report.targets.chrome.assetCount, 6);
  assert.equal(report.targets.firefox.assetCount, 6);
  assert.equal(report.targets.chrome.runtimeFileCount, 8);
  assert.equal(report.targets.firefox.runtimeFileCount, 8);
});

test("browser-specific settings are omitted for Chrome and retained for Firefox", async (t) => {
  const rootDir = await createFixture(t);
  await writeJson(
    path.join(rootDir, "dist", "chrome", "manifest.json"),
    sourceManifest
  );
  const firefoxManifest = clone(sourceManifest);
  delete firefoxManifest.browser_specific_settings;
  await writeJson(
    path.join(rootDir, "dist", "firefox", "manifest.json"),
    firefoxManifest
  );

  await assert.rejects(
    verifyPackageSources({ rootDir }),
    (error) => {
      assert.match(error.message, /chrome manifest must omit browser_specific_settings/);
      assert.match(error.message, /firefox manifest must retain browser_specific_settings/);
      return true;
    }
  );
});

test("missing manifest and options-page assets are both reported", async (t) => {
  const rootDir = await createFixture(t);
  await rm(path.join(rootDir, "dist", "chrome", "src", "content.js"));
  await rm(path.join(rootDir, "dist", "firefox", "src", "options.js"));

  await assert.rejects(
    verifyPackageSources({ rootDir }),
    (error) => {
      assert.match(error.message, /chrome missing declared asset: src\/content\.js/);
      assert.match(
        error.message,
        /firefox options page options\.html references missing asset: src\/options\.js/
      );
      return true;
    }
  );
});

test("generated manifest drift fails even when declared assets still exist", async (t) => {
  const rootDir = await createFixture(t);
  const chromeManifest = clone(sourceManifest);
  delete chromeManifest.browser_specific_settings;
  chromeManifest.permissions = ["tabs"];
  await writeJson(
    path.join(rootDir, "dist", "chrome", "manifest.json"),
    chromeManifest
  );

  await assert.rejects(
    verifyPackageSources({ rootDir }),
    /chrome generated manifest differs from the source manifest after its expected browser transform/
  );
});

test("unreferenced copied runtime files fail package verification", async (t) => {
  const rootDir = await createFixture(t);
  for (const basePath of [
    rootDir,
    path.join(rootDir, "dist", "chrome"),
    path.join(rootDir, "dist", "firefox"),
  ]) {
    await writeAsset(path.join(basePath, "src", "orphan.js"), "(() => {})();\n");
  }

  await assert.rejects(
    verifyPackageSources({ rootDir }),
    /contains unreferenced runtime file copied from source: src\/orphan\.js/
  );
});

test("modified and unexpected generated files both fail", async (t) => {
  const rootDir = await createFixture(t);
  await writeAsset(
    path.join(rootDir, "dist", "chrome", "src", "content.js"),
    "throw new Error('generated drift');\n"
  );
  await writeAsset(
    path.join(rootDir, "dist", "firefox", "src", "unexpected.js"),
    "(() => {})();\n"
  );

  await assert.rejects(
    verifyPackageSources({ rootDir }),
    (error) => {
      assert.match(
        error.message,
        /chrome generated runtime file differs from source: src\/content\.js/
      );
      assert.match(
        error.message,
        /firefox contains unexpected generated file: src\/unexpected\.js/
      );
      return true;
    }
  );
});

test("symbolic links are rejected in source and generated package trees", async (t) => {
  const sourceLinkedRoot = await createFixture(t);
  await symlink(
    path.join(sourceLinkedRoot, "src", "content.js"),
    path.join(sourceLinkedRoot, "src", "linked.js")
  );
  await assert.rejects(
    verifyPackageSources({ rootDir: sourceLinkedRoot }),
    /source runtime tree is invalid:.*symbolic link/
  );

  const generatedLinkedRoot = await createFixture(t);
  await symlink(
    path.join(generatedLinkedRoot, "dist", "chrome", "src", "content.js"),
    path.join(generatedLinkedRoot, "dist", "chrome", "src", "linked.js")
  );
  await assert.rejects(
    verifyPackageSources({ rootDir: generatedLinkedRoot }),
    /chrome generated package tree is invalid:.*symbolic link/
  );
});
