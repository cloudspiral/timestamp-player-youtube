import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");

const runtimeEntries = ["options.html", "src", "icons", "LICENSE"];
const ignoredRuntimeNames = new Set([".DS_Store"]);

async function copyRuntimeEntry(sourcePath, targetPath) {
  if (ignoredRuntimeNames.has(path.basename(sourcePath))) {
    return;
  }

  const entries = await readdir(sourcePath, { withFileTypes: true }).catch((error) => {
    if (error.code !== "ENOTDIR") {
      throw error;
    }
    return null;
  });

  if (!entries) {
    await copyFile(sourcePath, targetPath);
    return;
  }

  await mkdir(targetPath, { recursive: true });

  await Promise.all(
    entries.map((entry) =>
      copyRuntimeEntry(path.join(sourcePath, entry.name), path.join(targetPath, entry.name))
    )
  );
}

async function copyRuntimeEntries(targetDir) {
  await mkdir(targetDir, { recursive: true });

  await Promise.all(
    runtimeEntries.map((entry) =>
      copyRuntimeEntry(path.join(rootDir, entry), path.join(targetDir, entry))
    )
  );
}

async function writeManifest(targetDir, { includeFirefoxSettings }) {
  const manifest = JSON.parse(await readFile(path.join(rootDir, "manifest.json"), "utf8"));

  if (!includeFirefoxSettings) {
    delete manifest.browser_specific_settings;
  }

  await writeFile(
    path.join(targetDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
}

async function prepareTarget(name, options) {
  const targetDir = path.join(distDir, name);

  await rm(targetDir, { recursive: true, force: true });
  await copyRuntimeEntries(targetDir);
  await writeManifest(targetDir, options);
}

await mkdir(distDir, { recursive: true });
await prepareTarget("chrome", { includeFirefoxSettings: false });
await prepareTarget("firefox", { includeFirefoxSettings: true });

console.log("Prepared dist/chrome and dist/firefox package sources.");
