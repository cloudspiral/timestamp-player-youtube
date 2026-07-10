import { spawn, spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SMOKE_PATH = "/__timestamp_player_smoke_pass";
const SMOKE_FAILURE_PATH = "/__timestamp_player_smoke_fail";
const SMOKE_MEDIA_PATH = "/__timestamp_player_smoke_media.wav";
const SMOKE_TIMEOUT_MS = 45_000;
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = path.join(rootDir, "dist", "chrome");
const webExtBin = path.join(rootDir, "node_modules", "web-ext", "bin", "web-ext.js");

async function main() {
  await Promise.all([
    assertReadable(path.join(extensionDir, "manifest.json"), [
      "Chrome package sources are missing.",
      "Run `npm run prepare:packages` before the browser smoke test.",
    ].join(" ")),
    assertReadable(webExtBin, "web-ext is missing. Run `npm ci` before the browser smoke test."),
  ]);

  const chromeBinary = await findChromeBinary();
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "timestamp-player-chrome-smoke-")
  );
  let browserRunner = null;
  let completed = false;
  let server = null;

  try {
    const certificate = createTestCertificate(temporaryDirectory);
    const fixture = await startFixtureServer(certificate);
    server = fixture.server;
    const address = server.address();
    const fixtureUrl = `https://www.youtube.com:${address.port}/`;
    browserRunner = launchBrowserRunner(chromeBinary, fixtureUrl, {
      onReady: fixture.releaseDocument,
    });

    let result;
    try {
      result = await raceWithTimeout(
        [fixture.success, rejectOnProcessExit(browserRunner)],
        SMOKE_TIMEOUT_MS,
        () => {
          return [
            "Timed out waiting for the cold SPA navigation to expose the Tracklist launcher.",
            fixture.describeRequests(),
            formatRunnerOutput(browserRunner),
          ].join("");
        }
      );
    } catch (error) {
      throw new Error(
        `${error.message}${fixture.describeRequests()}${formatRunnerOutput(browserRunner)}`,
        { cause: error }
      );
    }

    console.log(
      `Chrome extension smoke passed: ${result.href} rendered ${JSON.stringify(result.launcherText)} without a reload.`
    );
    completed = true;
  } finally {
    const cleanupErrors = [];
    await captureCleanupFailure(
      () => terminateBrowserRunner(browserRunner),
      "browser runner",
      cleanupErrors
    );
    await captureCleanupFailure(
      () => closeFixtureServer(server),
      "fixture server",
      cleanupErrors
    );
    await captureCleanupFailure(
      () => rm(temporaryDirectory, { force: true, recursive: true }),
      "temporary directory",
      cleanupErrors
    );

    if (cleanupErrors.length && completed) {
      throw new AggregateError(cleanupErrors, "Chrome smoke cleanup failed");
    }
    if (cleanupErrors.length) {
      console.error(`Chrome smoke cleanup warnings:\n${cleanupErrors.map((error) => error.message).join("\n")}`);
    }
  }
}

async function findChromeBinary() {
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

function createTestCertificate(directory) {
  const certificatePath = path.join(directory, "fixture-certificate.pem");
  const privateKeyPath = path.join(directory, "fixture-private-key.pem");
  const result = spawnSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    privateKeyPath,
    "-out",
    certificatePath,
    "-days",
    "1",
    "-subj",
    "/CN=www.youtube.com",
    "-addext",
    "subjectAltName=DNS:www.youtube.com",
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    throw new Error(`Could not run OpenSSL for the local HTTPS certificate: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exited with ${result.status}`).trim();
    throw new Error(`Could not create the local HTTPS certificate: ${detail}`);
  }
  return { certificatePath, privateKeyPath };
}

async function startFixtureServer({ certificatePath, privateKeyPath }) {
  const [cert, key] = await Promise.all([
    readFile(certificatePath),
    readFile(privateKeyPath),
  ]);
  let reportFailure;
  let reportSuccess;
  let releaseDocument;
  const success = new Promise((resolve, reject) => {
    reportSuccess = resolve;
    reportFailure = reject;
  });
  const documentReleased = new Promise((resolve) => {
    releaseDocument = resolve;
  });
  const requests = [];
  const smokeMedia = createSilentWav({ durationSeconds: 3 });
  const server = createServer({ cert, key }, async (request, response) => {
    requests.push(`${request.method || "UNKNOWN"} ${request.url || ""}`);
    if (request.method === "GET" && request.url === SMOKE_MEDIA_PATH) {
      response.writeHead(200, {
        "accept-ranges": "bytes",
        "cache-control": "no-store",
        "content-length": smokeMedia.length,
        "content-type": "audio/wav",
      });
      response.end(smokeMedia);
      return;
    }
    if (
      request.method === "POST"
      && (request.url === SMOKE_PATH || request.url === SMOKE_FAILURE_PATH)
    ) {
      readJsonBody(request)
        .then((result) => {
          if (request.url === SMOKE_FAILURE_PATH) {
            throw new Error(`Smoke fixture did not become ready: ${JSON.stringify(result)}`);
          }
          validateSmokeResult(result);
          response.writeHead(204, { "cache-control": "no-store" });
          response.end();
          reportSuccess(result);
        })
        .catch((error) => {
          response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          response.end(error.message);
          reportFailure(error);
        });
      return;
    }

    if (request.method !== "GET" || request.url !== "/") {
      response.writeHead(404, {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      });
      response.end("The smoke fixture permits only its initial non-watch document.");
      return;
    }

    await documentReleased;
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
    });
    response.end(createFixtureHtml());
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    describeRequests: () => requests.length
      ? ` Fixture requests: ${requests.join(", ")}.`
      : " Fixture received no requests.",
    releaseDocument: () => releaseDocument(),
    server,
    success,
  };
}

function createFixtureHtml() {
  return `<!doctype html>
<html data-started-off-watch="true">
  <head>
    <meta charset="utf-8">
    <title>Timestamp Player cold SPA fixture</title>
    <style>
      body, ytd-page-manager, ytd-watch-flexy, ytd-watch-metadata,
      #description-inline-expander, #expanded, #actions,
      #top-level-buttons-computed { display: block; min-width: 320px; min-height: 32px; }
      #movie_player, video { display: block; width: 640px; height: 360px; }
      #top-level-buttons-computed { width: 520px; height: 40px; }
    </style>
  </head>
  <body>
    <main id="home">Initial non-watch route</main>
    <script>
      let reported = false;
      sessionStorage.setItem("timestamp-player:debug", "1");

      function reportSuccessWhenReady() {
        const launcher = document.getElementById("timestamp-player-launcher");
        const root = document.getElementById("timestamp-player-root");
        if (
          reported
          || !launcher
          || !root
          || location.pathname !== "/watch"
          || new URLSearchParams(location.search).get("v") !== "smoke-video"
        ) {
          return;
        }
        reported = true;
        fetch(${JSON.stringify(SMOKE_PATH)}, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            href: location.href,
            launcherText: launcher.textContent.trim(),
            startedOffWatch: document.documentElement.dataset.startedOffWatch === "true"
          })
        });
      }

      function reportFailure() {
        if (reported) {
          return;
        }
        reported = true;
        const video = document.querySelector("video");
        const description = document.querySelector("#description-inline-expander");
        const playerRoot = document.getElementById("timestamp-player-root");
        const videoRect = video?.getBoundingClientRect();
        fetch(${JSON.stringify(SMOKE_FAILURE_PATH)}, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            href: location.href,
            hasActionRow: Boolean(document.querySelector("#top-level-buttons-computed")),
            hasDescription: Boolean(document.querySelector("#description-inline-expander")),
            hasLauncher: Boolean(document.getElementById("timestamp-player-launcher")),
            hasPlayerRoot: Boolean(playerRoot),
            hasVideo: Boolean(video),
            descriptionText: description?.innerText || description?.textContent || "",
            documentReadyState: document.readyState,
            playerClassName: playerRoot?.className || "",
            videoDuration: video?.duration,
            videoReadyState: video?.readyState,
            videoRect: videoRect ? { width: videoRect.width, height: videoRect.height } : null
          })
        });
      }

      function createWatchFixture() {
        document.body.innerHTML = \`
          <ytd-page-manager>
            <ytd-watch-flexy video-id="smoke-video">
              <div id="movie_player" class="html5-video-player">
                <video class="html5-main-video" preload="auto" src=${JSON.stringify(SMOKE_MEDIA_PATH)}></video>
              </div>
              <ytd-watch-metadata>
                <div id="description-inline-expander" expanded>
                  <div id="expanded">
                    <a href="/watch?v=smoke-video&t=0s">0:00 Opening</a><br>
                    <a href="/watch?v=smoke-video&t=1s">0:01 Middle</a><br>
                    <a href="/watch?v=smoke-video&t=2s">0:02 Finale</a>
                  </div>
                </div>
                <div id="above-the-fold">
                  <div id="actions">
                    <div id="top-level-buttons-computed">
                      <ytd-button-renderer id="share-button"><button type="button">Localized action</button></ytd-button-renderer>
                    </div>
                  </div>
                </div>
              </ytd-watch-metadata>
            </ytd-watch-flexy>
          </ytd-page-manager>
        \`;
      }

      new MutationObserver(reportSuccessWhenReady).observe(document.documentElement, {
        childList: true,
        subtree: true
      });
      window.addEventListener("load", () => {
        setTimeout(() => {
          history.pushState({}, "", "/watch?v=smoke-video");
          createWatchFixture();
          document.dispatchEvent(new CustomEvent("yt-navigate-finish", { bubbles: true }));
          window.dispatchEvent(new CustomEvent("yt-navigate-finish"));
          reportSuccessWhenReady();
          setTimeout(reportFailure, 12_000);
        }, 500);
      });
    </script>
  </body>
</html>`;
}

function createSilentWav({ durationSeconds, sampleRate = 8_000 }) {
  const sampleCount = Math.ceil(durationSeconds * sampleRate);
  const buffer = Buffer.alloc(44 + sampleCount, 128);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + sampleCount, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate, 28);
  buffer.writeUInt16LE(1, 32);
  buffer.writeUInt16LE(8, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(sampleCount, 40);
  return buffer;
}

function launchBrowserRunner(chromeBinary, fixtureUrl, { onReady }) {
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
    "--args=--host-resolver-rules=MAP www.youtube.com 127.0.0.1,EXCLUDE localhost",
  ];
  const child = spawn(process.execPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.output = "";
  const appendOutput = (chunk) => {
    child.output = `${child.output}${chunk}`.slice(-8_000);
    if (child.output.includes("Automatic extension reloading has been disabled")) {
      onReady();
    }
  };
  child.stdout.on("data", appendOutput);
  child.stderr.on("data", appendOutput);
  return child;
}

function rejectOnProcessExit(child) {
  return new Promise((_, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      reject(new Error(
        `Browser runner exited before the smoke test passed (code ${code}, signal ${signal}).${formatRunnerOutput(child)}`
      ));
    });
  });
}

async function raceWithTimeout(promises, timeoutMs, createMessage) {
  let timeoutId;
  try {
    return await Promise.race([
      ...promises,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(createMessage())), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8_192) {
      throw new Error("Smoke result body is too large");
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function validateSmokeResult(result) {
  if (
    result?.startedOffWatch !== true
    || typeof result.href !== "string"
    || !result.href.includes("/watch?v=smoke-video")
    || typeof result.launcherText !== "string"
    || !result.launcherText
  ) {
    throw new Error("Smoke result did not prove a cold non-watch to watch transition");
  }
}

function formatRunnerOutput(child) {
  const output = child?.output?.trim();
  return output ? ` Recent browser output:\n${output}` : "";
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

async function terminateBrowserRunner(child) {
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

async function closeFixtureServer(server) {
  if (!server) {
    return;
  }
  const closed = new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  server.closeAllConnections?.();
  await raceWithTimeout(
    [closed],
    2_000,
    () => "Timed out closing the Chrome smoke fixture server"
  );
}

async function captureCleanupFailure(cleanup, label, errors) {
  try {
    await cleanup();
  } catch (error) {
    errors.push(new Error(`${label}: ${error.message}`, { cause: error }));
  }
}

await main();
