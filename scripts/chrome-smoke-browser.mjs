import { spawn, spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = path.join(rootDir, "dist", "chrome");
const webExtBin = path.join(rootDir, "node_modules", "web-ext", "bin", "web-ext.js");

export async function assertBrowserPrerequisites() {
  await Promise.all([
    assertReadable(path.join(extensionDir, "manifest.json"), [
      "Chrome package sources are missing.",
      "Run `npm run prepare:packages` before the browser smoke test.",
    ].join(" ")),
    assertReadable(webExtBin, "web-ext is missing. Run `npm ci` before the browser smoke test."),
  ]);
}

export async function findChromeBinary() {
  const configuredBinary = process.env.CHROME_BIN?.trim();
  const candidates = [
    configuredBinary,
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome-for-testing",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
      : "",
    process.env.PROGRAMFILES
      ? path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe")
      : "",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch (_error) {
      // Try the next platform-specific location.
    }
  }

  throw new Error(
    "Chrome or Chromium was not found. Set CHROME_BIN to run the packaged extension smoke test."
  );
}

export function createBrowserRunnerArgs(chromeBinary, fixtureUrl, { hostnames }) {
  const hostResolverRules = [
    ...hostnames.map((hostname) => `MAP ${hostname} 127.0.0.1`),
    "EXCLUDE localhost",
  ].join(",");
  const args = [
    webExtBin,
    "run",
    "--target=chromium",
    `--chromium-binary=${chromeBinary}`,
    `--source-dir=${extensionDir}`,
    `--start-url=${fixtureUrl}`,
    "--no-reload",
    "--no-input",
    "--args=--headless=new",
    "--args=--disable-gpu",
    "--args=--ignore-certificate-errors",
    "--args=--no-proxy-server",
    `--args=--host-resolver-rules=${hostResolverRules}`,
  ];
  return args;
}

export function launchBrowserRunner(chromeBinary, fixtureUrl, { hostnames, onReady }) {
  const args = createBrowserRunnerArgs(chromeBinary, fixtureUrl, { hostnames });
  const child = spawn(process.execPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.output = "";
  let ready = false;
  const appendOutput = (chunk) => {
    const combinedOutput = `${child.output}${chunk}`;
    if (!ready && combinedOutput.includes("Automatic extension reloading has been disabled")) {
      ready = true;
      onReady();
    }
    child.output = combinedOutput.slice(-8_000);
  };
  child.stdout.on("data", appendOutput);
  child.stderr.on("data", appendOutput);
  return child;
}

export function rejectOnProcessExit(child) {
  return new Promise((_, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      reject(new Error(
        `Browser runner exited before the smoke test passed (code ${code}, signal ${signal}).`
      ));
    });
  });
}

export function formatRunnerOutput(child) {
  const output = child?.output?.trim();
  return output ? ` Recent browser output:\n${output}` : "";
}

export async function terminateBrowserRunner(child) {
  if (!isProcessRunning(child)) {
    return;
  }

  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0 && isProcessRunning(child)) {
      const detail = (
        result.error?.message
        || result.stderr
        || result.stdout
        || `exited with ${result.status}`
      ).trim();
      throw new Error(`taskkill could not terminate the browser runner: ${detail}`);
    }
    await waitForProcessExit(child, 2_000);
    if (isProcessRunning(child)) {
      throw new Error("taskkill reported success but the browser runner remained alive");
    }
    return;
  }

  // web-ext handles SIGINT by asking its Chromium runner to tear down the
  // detached browser process tree and temporary profile.
  child.kill("SIGINT");
  await waitForProcessExit(child, 4_000);
  if (isProcessRunning(child)) {
    child.kill("SIGTERM");
    await waitForProcessExit(child, 2_000);
  }
  if (isProcessRunning(child)) {
    child.kill("SIGKILL");
    await waitForProcessExit(child, 2_000);
  }
  if (isProcessRunning(child)) {
    throw new Error("browser runner remained alive after SIGINT, SIGTERM, and SIGKILL");
  }
}

async function assertReadable(filePath, message) {
  try {
    await access(filePath);
  } catch (_error) {
    throw new Error(message);
  }
}

async function waitForProcessExit(child, timeoutMs) {
  if (!isProcessRunning(child)) {
    return;
  }
  await new Promise((resolve) => {
    let timeoutId;
    const finish = () => {
      clearTimeout(timeoutId);
      child.removeListener("exit", finish);
      resolve();
    };
    child.once("exit", finish);
    timeoutId = setTimeout(finish, timeoutMs);
    if (!isProcessRunning(child)) {
      finish();
    }
  });
}

function isProcessRunning(child) {
  return Boolean(child && child.exitCode === null && child.signalCode === null);
}
