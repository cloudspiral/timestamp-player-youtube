import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkJavaScriptFiles,
  discoverJavaScriptFiles,
} from "../scripts/check-javascript.mjs";

async function createProject(t) {
  const rootDir = await mkdtemp(path.join(tmpdir(), "timestamp-player-js-check-"));
  t.after(() => rm(rootDir, { force: true, recursive: true }));
  await Promise.all([
    mkdir(path.join(rootDir, "src", "nested"), { recursive: true }),
    mkdir(path.join(rootDir, "scripts", "release"), { recursive: true }),
    mkdir(path.join(rootDir, "tests", "fixtures"), { recursive: true }),
  ]);
  return rootDir;
}

async function writeProjectFile(rootDir, relativePath, contents = "export {};\n") {
  const filename = path.join(rootDir, ...relativePath.split("/"));
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, contents);
  return filename;
}

test("recursive discovery includes JS module variants while excluding other files", async (t) => {
  const rootDir = await createProject(t);
  await Promise.all([
    writeProjectFile(rootDir, "src/content.js"),
    writeProjectFile(rootDir, "src/nested/player.mjs"),
    writeProjectFile(rootDir, "src/nested/legacy.cjs", "module.exports = {};\n"),
    writeProjectFile(rootDir, "scripts/release/verify.js"),
    writeProjectFile(rootDir, "tests/checker.test.mjs"),
    writeProjectFile(rootDir, "src/content.css", ".player {}\n"),
    writeProjectFile(rootDir, "tests/fixtures/data.json", "{}\n"),
    writeProjectFile(rootDir, "outside.js"),
  ]);

  const files = await discoverJavaScriptFiles({ rootDir });
  assert.deepEqual(files.map((file) => path.relative(rootDir, file)), [
    path.join("scripts", "release", "verify.js"),
    path.join("src", "content.js"),
    path.join("src", "nested", "legacy.cjs"),
    path.join("src", "nested", "player.mjs"),
    path.join("tests", "checker.test.mjs"),
  ]);
});

test("discovery rejects symbolic links instead of following or skipping them", async (t) => {
  const rootDir = await createProject(t);
  const outsideFile = await writeProjectFile(rootDir, "outside.js");
  await symlink(outsideFile, path.join(rootDir, "src", "linked.js"));

  await assert.rejects(
    discoverJavaScriptFiles({ rootDir }),
    /does not allow symbolic links/
  );
});

test("package check script delegates to recursive discovery", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  );
  assert.equal(packageJson.scripts["check:js"], "node scripts/check-javascript.mjs");
});

test("syntax failures identify the file relative to the project root", async (t) => {
  const rootDir = await createProject(t);
  const brokenFile = await writeProjectFile(
    rootDir,
    "src/nested/broken.js",
    "const broken = ;\n"
  );

  assert.throws(
    () => checkJavaScriptFiles([brokenFile], { rootDir }),
    (error) => {
      assert.match(error.message, /src[/\\]nested[/\\]broken\.js/);
      assert.match(error.message, /SyntaxError/);
      assert.equal(error.message.includes(rootDir), false);
      return true;
    }
  );
});
