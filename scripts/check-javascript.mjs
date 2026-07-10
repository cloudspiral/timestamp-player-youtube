import { spawnSync } from "node:child_process";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectories = Object.freeze(["src", "scripts", "tests"]);
const javascriptExtensions = new Set([".cjs", ".js", ".mjs"]);

export async function discoverJavaScriptFiles({
  rootDir = projectRoot,
  directoryNames = sourceDirectories,
} = {}) {
  const files = [];
  for (const directoryName of directoryNames) {
    await collectJavaScriptFiles(path.resolve(rootDir, directoryName), files);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

async function collectJavaScriptFiles(directory, files) {
  const directoryStats = await lstat(directory);
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
    throw new TypeError(`JavaScript discovery root must be a real directory: ${directory}`);
  }
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new TypeError(`JavaScript discovery does not allow symbolic links: ${entryPath}`);
    }
    if (entry.isDirectory()) {
      await collectJavaScriptFiles(entryPath, files);
    } else if (entry.isFile() && javascriptExtensions.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }));
}

export function checkJavaScriptFiles(files, { rootDir = projectRoot } = {}) {
  const failures = [];
  for (const file of files) {
    const relativeFile = displayPath(file, rootDir);
    const result = spawnSync(process.execPath, ["--check", file], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) {
      failures.push(`${relativeFile}: ${result.error.message}`);
    } else if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || `exited with ${result.status}`)
        .trim()
        .split(file)
        .join(relativeFile);
      failures.push(`${relativeFile}\n${detail}`);
    }
  }

  if (failures.length) {
    throw new Error(`JavaScript syntax checks failed:\n\n${failures.join("\n\n")}`);
  }
  return files.length;
}

function displayPath(file, rootDir) {
  const relativePath = path.relative(rootDir, file);
  return relativePath && !relativePath.startsWith("..") ? relativePath : file;
}

export async function main() {
  const files = await discoverJavaScriptFiles();
  const checkedCount = checkJavaScriptFiles(files);
  console.log(`Checked ${checkedCount} JavaScript files.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
