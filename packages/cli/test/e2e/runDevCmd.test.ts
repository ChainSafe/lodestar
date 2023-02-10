import {ApiError, getClient} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {retry} from "@lodestar/utils";
import {describeCliTest} from "../utils/childprocRunner.js";
import {itDone} from "../utils/runUtils.js";

describeCliTest("Run dev command", function ({spawnCli}) {
  itDone("Run dev command with no --dataDir until beacon api is listening", async function (done) {
    const beaconPort = 39011;

    const devProc = spawnCli({pipeStdToParent: false, printOnlyOnError: true, logPrefix: "dev"}, [
      // ⏎
      "dev",
      "--reset",
      "--startValidators=0..7",
      `--rest.port=${beaconPort}`,
    ]);

    // Exit early if process exits
    devProc.on("exit", (code) => {
      if (code !== null && code > 0) {
        done(Error(`process exited with code ${code}`));
      }
    });

    const beaconUrl = `http://127.0.0.1:${beaconPort}`;
    const client = getClient({baseUrl: beaconUrl}, {config});

    // Wrap in retry since the API may not be listening yet
    await retry(() => client.node.getHealth().then((res) => ApiError.assert(res)), {retryDelay: 1000, retries: 60});
  });
});
