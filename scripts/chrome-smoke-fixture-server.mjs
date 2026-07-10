import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import path from "node:path";

import {
  SMOKE_FAILURE_PATH,
  SMOKE_MEDIA_PATH,
  SMOKE_PATH,
  createFixtureHtml,
  formatScenarioName,
  validateSmokeResult,
} from "./chrome-smoke-scenarios.mjs";

export function createTestCertificate(directory, { hostnames }) {
  const certificatePath = path.join(directory, "fixture-certificate.pem");
  const privateKeyPath = path.join(directory, "fixture-private-key.pem");
  const result = spawnSync("openssl", createCertificateArgs({
    certificatePath,
    hostnames,
    privateKeyPath,
  }), {
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

export function createCertificateArgs({ certificatePath, hostnames, privateKeyPath }) {
  if (!Array.isArray(hostnames) || hostnames.length === 0) {
    throw new TypeError("At least one Chrome smoke hostname is required");
  }
  return [
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
    `/CN=${hostnames[0]}`,
    "-addext",
    `subjectAltName=${hostnames.map((hostname) => `DNS:${hostname}`).join(",")}`,
  ];
}

export async function startFixtureServer({ certificatePath, privateKeyPath }, scenario) {
  const [cert, key] = await Promise.all([
    readFile(certificatePath),
    readFile(privateKeyPath),
  ]);
  let rejectResult;
  let resolveResult;
  let releaseDocumentRequest;
  const success = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const documentReleased = new Promise((resolve) => {
    releaseDocumentRequest = resolve;
  });
  const requests = [];
  const smokeMedia = createSilentWav({ durationSeconds: 3 });
  const server = createServer({ cert, key }, async (request, response) => {
    const requestHostname = getRequestHostname(request);
    requests.push(
      `${requestHostname || "unknown-host"} ${request.method || "UNKNOWN"} ${request.url || ""}`
    );
    if (requestHostname !== scenario.hostname) {
      response.writeHead(421, {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      });
      response.end(
        `Fixture expected ${scenario.hostname} but received ${requestHostname || "an invalid host"}.`
      );
      return;
    }
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
          validateSmokeResult(result, scenario);
          response.writeHead(204, { "cache-control": "no-store" });
          response.end();
          resolveResult(result);
        })
        .catch((error) => {
          response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          response.end(error.message);
          rejectResult(error);
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
    response.end(createFixtureHtml(scenario));
  });
  await new Promise((resolve, reject) => {
    const handleStartupError = (error) => {
      server.removeListener("listening", handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.removeListener("error", handleStartupError);
      resolve();
    };
    server.once("error", handleStartupError);
    server.once("listening", handleListening);
    server.listen(0, "127.0.0.1");
  });
  server.on("error", rejectResult);
  return {
    describeRequests: () => requests.length
      ? ` ${formatScenarioName(scenario)} fixture requests: ${requests.join(", ")}.`
      : ` ${formatScenarioName(scenario)} fixture received no requests.`,
    releaseDocument: releaseDocumentRequest,
    server,
    success,
  };
}

export function getRequestHostname(request) {
  const host = String(request?.headers?.host || "").trim();
  const match = host.match(/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)(?::(\d{1,5}))?$/i);
  if (!match) {
    return "";
  }
  const port = match[2] ? Number(match[2]) : null;
  if (port !== null && (port < 1 || port > 65_535)) {
    return "";
  }
  return match[1].toLowerCase();
}

export async function closeFixtureServer(server) {
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
