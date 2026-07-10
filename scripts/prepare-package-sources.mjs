import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectRuntimeFiles,
  copyRuntimeFiles,
} from "./package-runtime.mjs";

const defaultRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function writeManifest(targetDir, manifest, { includeFirefoxSettings }) {
  const targetManifest = JSON.parse(JSON.stringify(manifest));

  if (!includeFirefoxSettings) {
    delete targetManifest.browser_specific_settings;
  }

  await writeFile(
    path.join(targetDir, "manifest.json"),
    `${JSON.stringify(targetManifest, null, 2)}\n`
  );
}

async function prepareTarget(name, options, {
  distDir,
  manifest,
  runtimeFiles,
}) {
  const targetDir = path.join(distDir, name);

  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  await copyRuntimeFiles(runtimeFiles, targetDir);
  await writeManifest(targetDir, manifest, options);
}

export async function preparePackageSources({
  rootDir = defaultRootDir,
  distDir = path.join(rootDir, "dist"),
} = {}) {
  const manifestPath = path.join(rootDir, "manifest.json");
  const manifestStats = await lstat(manifestPath);
  if (manifestStats.isSymbolicLink() || !manifestStats.isFile()) {
    throw new TypeError("Source manifest must be a real regular file");
  }

  const [manifest, runtimeFiles] = await Promise.all([
    readFile(manifestPath, "utf8").then(JSON.parse),
    collectRuntimeFiles(rootDir),
  ]);
  await ensureRealOutputDirectory(distDir);
  await prepareTarget("chrome", { includeFirefoxSettings: false }, {
    distDir,
    manifest,
    runtimeFiles,
  });
  await prepareTarget("firefox", { includeFirefoxSettings: true }, {
    distDir,
    manifest,
    runtimeFiles,
  });

  return {
    runtimeFileCount: runtimeFiles.size,
    targets: ["chrome", "firefox"],
  };
}

async function ensureRealOutputDirectory(distDir) {
  let stats;
  try {
    stats = await lstat(distDir);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    await mkdir(distDir, { recursive: true });
    return;
  }

  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new TypeError("Package output root must be a real directory");
  }
}

export async function main() {
  const report = await preparePackageSources();
  console.log(
    `Prepared dist/chrome and dist/firefox package sources (${report.runtimeFileCount} runtime files).`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
