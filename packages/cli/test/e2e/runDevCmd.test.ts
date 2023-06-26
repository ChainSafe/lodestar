import {ApiError, getClient} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {retry} from "@lodestar/utils";
import {spawnCliCommand, stopChildProcess} from "@lodestar/test-util";

describe("Run dev command", function () {
  this.timeout("30s");

  it("Run dev command with no --dataDir until beacon api is listening", async () => {
    const beaconPort = 39011;

    const devProc = await spawnCliCommand(
      "packages/cli/bin/lodestar.js",
      ["dev", "--reset", "--startValidators=0..7", `--rest.port=${beaconPort}`],
      {pipeStdioToParent: false, pipeOnlyError: true, logPrefix: "dev"}
    );

    // Exit early if process exits
    devProc.on("exit", (code) => {
      if (code !== null && code > 0) {
        throw new Error(`process exited with code ${code}`);
      }
    });

    const beaconUrl = `http://127.0.0.1:${beaconPort}`;
    // To cleanup the event stream connection
    const httpClientController = new AbortController();
    const client = getClient({baseUrl: beaconUrl, getAbortSignal: () => httpClientController.signal}, {config});

    // Wrap in retry since the API may not be listening yet
    await retry(() => client.node.getHealth().then((res) => ApiError.assert(res)), {retryDelay: 1000, retries: 60});

    devProc.kill("SIGINT");
    httpClientController.abort();
    await stopChildProcess(devProc, "SIGKILL");
  });
});
