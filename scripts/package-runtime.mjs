import { copyFile, lstat, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

export const RUNTIME_ENTRY_NAMES = Object.freeze([
  "options.html",
  "src",
  "icons",
  "LICENSE",
]);
export const IGNORED_RUNTIME_NAMES = Object.freeze(new Set([".DS_Store"]));

export async function collectRuntimeFiles(rootDir, {
  entryNames = RUNTIME_ENTRY_NAMES,
  ignoredNames = IGNORED_RUNTIME_NAMES,
} = {}) {
  const files = new Map();
  for (const entryName of entryNames) {
    await collectPath(
      path.join(rootDir, entryName),
      normalizeRelativePath(entryName),
      files,
      ignoredNames
    );
  }
  return sortFileMap(files);
}

export async function collectFileTree(rootDir, {
  ignoredNames = IGNORED_RUNTIME_NAMES,
} = {}) {
  const rootStats = await lstat(rootDir);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new TypeError(`Package tree root must be a real directory: ${rootDir}`);
  }

  const files = new Map();
  for (const entry of await readSortedDirectory(rootDir)) {
    if (ignoredNames.has(entry.name)) {
      continue;
    }
    await collectPath(
      path.join(rootDir, entry.name),
      normalizeRelativePath(entry.name),
      files,
      ignoredNames
    );
  }
  return sortFileMap(files);
}

export async function copyRuntimeFiles(files, targetDir) {
  if (!(files instanceof Map)) {
    throw new TypeError("Runtime files must be a Map of package paths to source files");
  }

  for (const [relativePath, sourcePath] of files) {
    const targetPath = path.join(targetDir, ...relativePath.split("/"));
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
  }
  return files.size;
}

async function collectPath(absolutePath, relativePath, files, ignoredNames) {
  if (ignoredNames.has(path.basename(absolutePath))) {
    return;
  }

  const stats = await lstat(absolutePath);
  if (stats.isSymbolicLink()) {
    throw new TypeError(`Runtime package source must not be a symbolic link: ${relativePath}`);
  }
  if (stats.isDirectory()) {
    for (const entry of await readSortedDirectory(absolutePath)) {
      if (ignoredNames.has(entry.name)) {
        continue;
      }
      await collectPath(
        path.join(absolutePath, entry.name),
        path.posix.join(relativePath, entry.name),
        files,
        ignoredNames
      );
    }
    return;
  }
  if (!stats.isFile()) {
    throw new TypeError(`Runtime package source must be a regular file: ${relativePath}`);
  }
  files.set(relativePath, absolutePath);
}

async function readSortedDirectory(directory) {
  return (await readdir(directory, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeRelativePath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function sortFileMap(files) {
  return new Map(
    [...files.entries()].sort(([left], [right]) => left.localeCompare(right))
  );
}
