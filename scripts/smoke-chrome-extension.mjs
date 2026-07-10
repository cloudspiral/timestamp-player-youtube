import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertBrowserPrerequisites,
  findChromeBinary,
  formatRunnerOutput,
  launchBrowserRunner,
  rejectOnProcessExit,
  terminateBrowserRunner,
} from "./chrome-smoke-browser.mjs";
import {
  closeFixtureServer,
  createTestCertificate,
  startFixtureServer,
} from "./chrome-smoke-fixture-server.mjs";
import {
  SMOKE_HOSTNAMES,
  SMOKE_SCENARIOS,
  formatScenarioName,
} from "./chrome-smoke-scenarios.mjs";

const SMOKE_TIMEOUT_MS = 45_000;

async function main() {
  await assertBrowserPrerequisites();

  const chromeBinary = await findChromeBinary();
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "timestamp-player-chrome-smoke-")
  );
  let runError = null;
  try {
    const certificate = createTestCertificate(temporaryDirectory, { hostnames: SMOKE_HOSTNAMES });
    const scenarioErrors = [];
    for (const scenario of SMOKE_SCENARIOS) {
      try {
        await runSmokeScenario({ certificate, chromeBinary, scenario });
      } catch (error) {
        console.error(
          `${formatScenarioName(scenario)} Chrome smoke failed: ${formatErrorMessage(error)}`
        );
        scenarioErrors.push(new Error(
          `${formatScenarioName(scenario)} failed: ${error.message}`,
          { cause: error }
        ));
      }
    }
    if (scenarioErrors.length) {
      throw new AggregateError(
        scenarioErrors,
        `${scenarioErrors.length} of ${SMOKE_SCENARIOS.length} Chrome smoke scenarios failed`
      );
    }
  } catch (error) {
    runError = error;
  }

  const cleanupErrors = [];
  await captureCleanupFailure(
    () => rm(temporaryDirectory, { force: true, recursive: true }),
    "temporary directory",
    cleanupErrors
  );
  throwPrimaryOrCleanupErrors(runError, cleanupErrors, "Chrome smoke run");
}

async function runSmokeScenario({ certificate, chromeBinary, scenario }) {
  let browserRunner = null;
  let fixture = null;
  let runError = null;

  try {
    fixture = await startFixtureServer(certificate, scenario);
    const address = fixture.server.address();
    const fixtureUrl = `https://${scenario.hostname}:${address.port}/`;
    browserRunner = launchBrowserRunner(chromeBinary, fixtureUrl, {
      hostnames: SMOKE_HOSTNAMES,
      onReady: fixture.releaseDocument,
    });

    let result;
    try {
      result = await raceWithTimeout(
        [fixture.success, rejectOnProcessExit(browserRunner)],
        SMOKE_TIMEOUT_MS,
        () => "Timed out waiting for the cold SPA navigation to expose the Tracklist launcher."
      );
    } catch (error) {
      throw new Error(
        `${error.message}${fixture.describeRequests()}${formatRunnerOutput(browserRunner)}`,
        { cause: error }
      );
    }

    console.log(
      `${formatScenarioName(scenario)} Chrome smoke passed: ${result.href} rendered ${JSON.stringify(result.launcherText)} without a reload.`
    );
  } catch (error) {
    runError = error;
  }

  const cleanupErrors = [];
  await captureCleanupFailure(
    () => terminateBrowserRunner(browserRunner),
    `${formatScenarioName(scenario)} browser runner`,
    cleanupErrors
  );
  await captureCleanupFailure(
    () => closeFixtureServer(fixture?.server),
    `${formatScenarioName(scenario)} fixture server`,
    cleanupErrors
  );
  throwPrimaryOrCleanupErrors(
    runError,
    cleanupErrors,
    `${formatScenarioName(scenario)} Chrome smoke scenario`
  );
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

async function captureCleanupFailure(cleanup, label, errors) {
  try {
    await cleanup();
  } catch (error) {
    errors.push(new Error(`${label}: ${error.message}`, { cause: error }));
  }
}

function throwPrimaryOrCleanupErrors(primaryError, cleanupErrors, label) {
  if (primaryError && cleanupErrors.length) {
    throw new AggregateError(
      [primaryError, ...cleanupErrors],
      `${label} failed and cleanup also reported errors`
    );
  }
  if (primaryError) {
    throw primaryError;
  }
  if (cleanupErrors.length) {
    throw new AggregateError(cleanupErrors, `${label} cleanup failed`);
  }
}

function formatErrorMessage(error) {
  if (error instanceof AggregateError) {
    return [error.message, ...error.errors.map(formatErrorMessage)].join("\n  - ");
  }
  return error?.message || String(error);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
