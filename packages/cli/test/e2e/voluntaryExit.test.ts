import path from "node:path";
import {retry} from "@lodestar/utils";
import {getClient} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {interopSecretKey} from "@lodestar/state-transition";
import {testFilesDir} from "../utils.js";
import {describeCliTest, execCli} from "../utils/childprocRunner.js";
import {itDone} from "../utils/runUtils.js";

describeCliTest("voluntaryExit cmd", function ({spawnCli}) {
  this.timeout("60s");

  itDone("Perform a voluntary exit", async function (done) {
    const restPort = 9596;

    const devBnProc = spawnCli({pipeStdToParent: false, logPrefix: "dev"}, [
      // ⏎
      "dev",
      `--dataDir=${path.join(testFilesDir, "dev-voluntary-exit")}`,
      "--genesisValidators=8",
      "--startValidators=0..7",
      "--rest",
      `--rest.port=${restPort}`,
      // Speed up test to make genesis happen faster
      "--params.SECONDS_PER_SLOT=2",
      // Allow voluntary exists to be valid immediately
      "--params.SHARD_COMMITTEE_PERIOD=0",
    ]);
    // Exit early if process exits
    devBnProc.on("exit", (code) => {
      if (code !== null && code > 0) {
        done(Error(`devBnProc process exited with code ${code}`));
      }
    });

    const baseUrl = `http://localhost:${restPort}`;
    const client = getClient({baseUrl}, {config});

    // Wait for beacon node API to be available + genesis
    await retry(
      async () => {
        const head = await client.beacon.getBlockHeader("head");
        if (head.data.header.message.slot < 1) throw Error("pre-genesis");
      },
      {retryDelay: 1000, retries: 20}
    );

    const indexesToExit = [0, 1];
    const pubkeysToExit = indexesToExit.map((i) => interopSecretKey(i).toPublicKey().toHex());

    // Interop pubkeys
    // 0 0xa99a76ed7796f7be22d5b7e85deeb7c5677e88e511e0b337618f8c4eb61349b4bf2d153f649f7b
    // 1 0xb89bebc699769726a318c8e9971bd3171297c61aea4a6578a7a4f94b547dcba5bac16a89108b6b
    // 2 0xa3a32b0f8b4ddb83f1a0a853d81dd725dfe577d4f4c3db8ece52ce2b026eca84815c1a7e8e92a4
    // 3 0x88c141df77cd9d8d7a71a75c826c41a9c9f03c6ee1b180f3e7852f6a280099ded351b58d66e653

    await execCli([
      // ⏎
      "validator",
      "voluntary-exit",
      "--network=dev",
      "--yes",
      "--interopIndexes=0..3",
      `--server=${baseUrl}`,
      `--pubkeys=${pubkeysToExit.join(",")}`,
    ]);

    for (const pubkey of pubkeysToExit) {
      await retry(
        async () => {
          const {data} = await client.beacon.getStateValidator("head", pubkey);
          if (data.status !== "active_exiting") {
            throw Error("Validator not exiting");
          } else {
            // eslint-disable-next-line no-console
            console.log(`Confirmed validator ${pubkey} = ${data.status}`);
          }
        },
        {retryDelay: 1000, retries: 20}
      );
    }
  });
});
