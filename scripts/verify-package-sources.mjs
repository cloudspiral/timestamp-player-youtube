import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  collectFileTree,
  collectRuntimeFiles,
} from "./package-runtime.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetDefinitions = Object.freeze([
  { includeFirefoxSettings: false, name: "chrome" },
  { includeFirefoxSettings: true, name: "firefox" },
]);
const allowedUnreferencedRuntimePaths = new Set(["LICENSE"]);

export function collectManifestAssetPaths(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new TypeError("Manifest must be an object");
  }

  const assets = new Set();
  const add = (assetPath, context) => {
    if (assetPath === undefined || assetPath === null) {
      return;
    }
    assets.add(normalizePackagePath(assetPath, context));
  };
  const addArray = (values, context) => {
    if (values === undefined) {
      return;
    }
    if (!Array.isArray(values)) {
      throw new TypeError(`${context} must be an array`);
    }
    values.forEach((value, index) => add(value, `${context}[${index}]`));
  };
  const addTree = (value, context) => {
    if (value === undefined || value === null) {
      return;
    }
    if (typeof value === "string") {
      add(value, context);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => addTree(entry, `${context}[${index}]`));
      return;
    }
    if (typeof value === "object") {
      Object.entries(value).forEach(([key, entry]) => addTree(entry, `${context}.${key}`));
      return;
    }
    throw new TypeError(`${context} must contain asset paths`);
  };

  add(manifest.options_page, "options_page");
  add(manifest.options_ui?.page, "options_ui.page");
  add(manifest.devtools_page, "devtools_page");
  add(manifest.side_panel?.default_path, "side_panel.default_path");
  addTree(manifest.icons, "icons");

  for (const actionName of ["action", "browser_action", "page_action"]) {
    const action = manifest[actionName];
    add(action?.default_popup, `${actionName}.default_popup`);
    addTree(action?.default_icon, `${actionName}.default_icon`);
  }

  if (manifest.content_scripts !== undefined && !Array.isArray(manifest.content_scripts)) {
    throw new TypeError("content_scripts must be an array");
  }
  for (const [index, contentScript] of (manifest.content_scripts || []).entries()) {
    addArray(contentScript.js, `content_scripts[${index}].js`);
    addArray(contentScript.css, `content_scripts[${index}].css`);
  }

  add(manifest.background?.service_worker, "background.service_worker");
  add(manifest.background?.page, "background.page");
  addArray(manifest.background?.scripts, "background.scripts");
  addArray(manifest.sandbox?.pages, "sandbox.pages");

  if (manifest.chrome_url_overrides !== undefined) {
    if (!manifest.chrome_url_overrides || typeof manifest.chrome_url_overrides !== "object") {
      throw new TypeError("chrome_url_overrides must be an object");
    }
    Object.entries(manifest.chrome_url_overrides).forEach(([name, assetPath]) => {
      add(assetPath, `chrome_url_overrides.${name}`);
    });
  }

  if (manifest.declarative_net_request?.rule_resources !== undefined) {
    if (!Array.isArray(manifest.declarative_net_request.rule_resources)) {
      throw new TypeError("declarative_net_request.rule_resources must be an array");
    }
    manifest.declarative_net_request.rule_resources.forEach((resource, index) => {
      add(resource?.path, `declarative_net_request.rule_resources[${index}].path`);
    });
  }

  addTree(manifest.theme?.images, "theme.images");
  return [...assets].sort((left, right) => left.localeCompare(right));
}

export function collectOptionAssetPaths(html) {
  if (typeof html !== "string") {
    throw new TypeError("Options page HTML must be a string");
  }

  const assets = new Set();
  const tagPattern = /<(?:audio|img|link|script|source|video)\b[^>]*>/gi;
  for (const match of html.matchAll(tagPattern)) {
    const attributePattern = /\b(?:href|poster|src)\s*=\s*(["'])(.*?)\1/gi;
    for (const attribute of match[0].matchAll(attributePattern)) {
      const assetPath = normalizeLocalReference(attribute[2]);
      if (assetPath) {
        assets.add(assetPath);
      }
    }
  }
  return [...assets].sort((left, right) => left.localeCompare(right));
}

function normalizeLocalReference(reference) {
  const trimmed = reference.trim();
  if (!trimmed || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(trimmed)) {
    return null;
  }
  const suffixIndex = trimmed.search(/[?#]/);
  const withoutSuffix = suffixIndex >= 0 ? trimmed.slice(0, suffixIndex) : trimmed;
  if (!withoutSuffix) {
    return null;
  }
  if (withoutSuffix.includes("\\")) {
    throw new TypeError(`options page reference must use forward slashes: ${withoutSuffix}`);
  }
  const normalized = path.posix.normalize(withoutSuffix);
  if (path.posix.isAbsolute(normalized) || normalized === ".") {
    throw new TypeError(`options page reference is invalid: ${withoutSuffix}`);
  }
  return normalized;
}

function normalizePackagePath(assetPath, context) {
  if (typeof assetPath !== "string" || !assetPath.trim()) {
    throw new TypeError(`${context} must be a non-empty string path`);
  }
  const trimmed = assetPath.trim();
  if (trimmed.includes("\\")) {
    throw new TypeError(`${context} must use forward slashes: ${trimmed}`);
  }
  const normalized = path.posix.normalize(trimmed);
  if (
    path.posix.isAbsolute(normalized)
    || normalized === "."
    || normalized === ".."
    || normalized.startsWith("../")
  ) {
    throw new TypeError(`${context} escapes the package root: ${trimmed}`);
  }
  return normalized;
}

function collectOptionPagePaths(manifest) {
  const paths = new Set();
  if (manifest.options_page !== undefined) {
    paths.add(normalizePackagePath(manifest.options_page, "options_page"));
  }
  if (manifest.options_ui?.page !== undefined) {
    paths.add(normalizePackagePath(manifest.options_ui.page, "options_ui.page"));
  }
  return [...paths];
}

export async function verifyPackageSources({
  rootDir = projectRoot,
  distDir = path.join(rootDir, "dist"),
} = {}) {
  const issues = [];
  const sourceManifestPath = path.join(rootDir, "manifest.json");
  const sourceManifest = await readJson(sourceManifestPath, "source manifest", issues);
  let sourceRuntimeFiles = null;
  try {
    sourceRuntimeFiles = await collectRuntimeFiles(rootDir);
  } catch (error) {
    issues.push(`source runtime tree is invalid: ${error.message}`);
  }
  if (!sourceManifest || !sourceRuntimeFiles) {
    throwVerificationError(issues);
  }
  if (!Object.hasOwn(sourceManifest, "browser_specific_settings")) {
    issues.push("source manifest must declare browser_specific_settings for Firefox");
  }

  const report = { targets: {} };
  for (const definition of targetDefinitions) {
    const targetDir = path.join(distDir, definition.name);
    let targetFiles = null;
    try {
      targetFiles = await collectFileTree(targetDir);
    } catch (error) {
      issues.push(`${definition.name} generated package tree is invalid: ${error.message}`);
    }
    const targetManifestPath = path.join(targetDir, "manifest.json");
    const targetManifest = await readJson(
      targetManifestPath,
      `${definition.name} generated manifest`,
      issues
    );
    if (!targetManifest || !targetFiles) {
      continue;
    }

    verifyTargetManifest(sourceManifest, targetManifest, definition, issues);
    const manifestAssets = collectAssetsOrReport(targetManifest, definition.name, issues);
    const allAssets = new Set(manifestAssets);
    for (const assetPath of manifestAssets) {
      if (!targetFiles.has(assetPath)) {
        issues.push(`${definition.name} missing declared asset: ${assetPath}`);
      }
    }

    for (const optionsPath of collectOptionsOrReport(targetManifest, definition.name, issues)) {
      const absoluteOptionsPath = path.join(targetDir, ...optionsPath.split("/"));
      if (!targetFiles.has(optionsPath)) {
        continue;
      }
      let html;
      try {
        html = await readFile(absoluteOptionsPath, "utf8");
      } catch (error) {
        issues.push(`${definition.name} could not read options page ${optionsPath}: ${error.message}`);
        continue;
      }

      let optionAssets;
      try {
        optionAssets = collectOptionAssetPaths(html);
      } catch (error) {
        issues.push(`${definition.name} options page ${optionsPath} is invalid: ${error.message}`);
        continue;
      }
      const optionsDirectory = path.posix.dirname(optionsPath);
      for (const optionAsset of optionAssets) {
        let packageAsset;
        try {
          packageAsset = normalizePackagePath(
            path.posix.join(optionsDirectory, optionAsset),
            `${optionsPath} asset`
          );
        } catch (error) {
          issues.push(`${definition.name} options page ${optionsPath} is invalid: ${error.message}`);
          continue;
        }
        allAssets.add(packageAsset);
        if (!targetFiles.has(packageAsset)) {
          issues.push(
            `${definition.name} options page ${optionsPath} references missing asset: ${packageAsset}`
          );
        }
      }
    }

    await verifyRuntimeTree({
      allAssets,
      issues,
      sourceRuntimeFiles,
      targetFiles,
      targetName: definition.name,
    });
    report.targets[definition.name] = {
      assetCount: allAssets.size,
      runtimeFileCount: targetFiles.size,
    };
  }

  if (issues.length) {
    throwVerificationError(issues);
  }
  return report;
}

async function verifyRuntimeTree({
  allAssets,
  issues,
  sourceRuntimeFiles,
  targetFiles,
  targetName,
}) {
  const expectedPaths = new Set(["manifest.json", ...sourceRuntimeFiles.keys()]);
  for (const targetPath of targetFiles.keys()) {
    if (!expectedPaths.has(targetPath)) {
      issues.push(`${targetName} contains unexpected generated file: ${targetPath}`);
    }
  }

  for (const [runtimePath, sourcePath] of sourceRuntimeFiles) {
    const targetPath = targetFiles.get(runtimePath);
    if (!targetPath) {
      issues.push(`${targetName} missing copied runtime file: ${runtimePath}`);
      continue;
    }

    const [sourceBytes, targetBytes] = await Promise.all([
      readFile(sourcePath),
      readFile(targetPath),
    ]);
    if (!sourceBytes.equals(targetBytes)) {
      issues.push(`${targetName} generated runtime file differs from source: ${runtimePath}`);
    }
    if (
      !allowedUnreferencedRuntimePaths.has(runtimePath)
      && !allAssets.has(runtimePath)
    ) {
      issues.push(`${targetName} contains unreferenced runtime file copied from source: ${runtimePath}`);
    }
  }
}

function verifyTargetManifest(sourceManifest, targetManifest, definition, issues) {
  const hasFirefoxSettings = Object.hasOwn(targetManifest, "browser_specific_settings");
  if (definition.includeFirefoxSettings) {
    if (!hasFirefoxSettings) {
      issues.push("firefox manifest must retain browser_specific_settings");
    } else if (!isDeepStrictEqual(
      targetManifest.browser_specific_settings,
      sourceManifest.browser_specific_settings
    )) {
      issues.push("firefox manifest must retain source browser_specific_settings unchanged");
    }
  } else if (hasFirefoxSettings) {
    issues.push("chrome manifest must omit browser_specific_settings");
  }

  const expectedManifest = JSON.parse(JSON.stringify(sourceManifest));
  if (!definition.includeFirefoxSettings) {
    delete expectedManifest.browser_specific_settings;
  }
  if (!isDeepStrictEqual(targetManifest, expectedManifest)) {
    issues.push(
      `${definition.name} generated manifest differs from the source manifest after its expected browser transform`
    );
  }
}

function collectAssetsOrReport(manifest, targetName, issues) {
  try {
    return collectManifestAssetPaths(manifest);
  } catch (error) {
    issues.push(`${targetName} manifest asset declarations are invalid: ${error.message}`);
    return [];
  }
}

function collectOptionsOrReport(manifest, targetName, issues) {
  try {
    return collectOptionPagePaths(manifest);
  } catch (error) {
    issues.push(`${targetName} options declaration is invalid: ${error.message}`);
    return [];
  }
}

async function readJson(filename, label, issues) {
  try {
    const stats = await lstat(filename);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new TypeError("path is not a real regular file");
    }
    return JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    issues.push(`${label} is missing or invalid at ${filename}: ${error.message}`);
    return null;
  }
}

function throwVerificationError(issues) {
  throw new Error(`Package source verification failed:\n- ${issues.join("\n- ")}`);
}

export async function main() {
  const report = await verifyPackageSources();
  const summary = targetDefinitions
    .map(({ name }) => {
      const target = report.targets[name];
      return `${name}: ${target.assetCount} referenced assets, ${target.runtimeFileCount} files`;
    })
    .join(", ");
  console.log(`Verified generated package sources (${summary}).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
