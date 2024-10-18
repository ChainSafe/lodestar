import {describe, it, vi, onTestFinished} from "vitest";
import {getClient} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {retry} from "@lodestar/utils";
import {spawnCliCommand, stopChildProcess} from "@lodestar/test-utils";

describe("Run dev command", () => {
  vi.setConfig({testTimeout: 30_000});

  it("Run dev command with no --dataDir until beacon api is listening", async () => {
    const beaconPort = 39011;

    const devProc = await spawnCliCommand(
      "packages/cli/bin/lodestar.js",
      ["dev", "--reset", "--startValidators=0..7", `--rest.port=${beaconPort}`],
      {pipeStdioToParent: true, logPrefix: "dev"}
    );
    onTestFinished(async () => {
      await stopChildProcess(devProc);
    });

    // Exit early if process exits
    devProc.on("exit", (code) => {
      if (code !== null && code > 0) {
        throw new Error(`process exited with code ${code}`);
      }
    });

    const beaconUrl = `http://127.0.0.1:${beaconPort}`;
    // To cleanup the event stream connection
    const httpClientController = new AbortController();
    const client = getClient({baseUrl: beaconUrl, globalInit: {signal: httpClientController.signal}}, {config});

    // Wrap in retry since the API may not be listening yet
    await retry(() => client.node.getHealth().then((res) => res.assertOk()), {retryDelay: 1000, retries: 60});
    httpClientController.abort();

    // The process will exit when the test finishes
    // Default behavior would be the abort signal will be passed to the child process
    // The earlier registered callback will consider it as an error and throw
    devProc.removeAllListeners("exit");
  });
});
