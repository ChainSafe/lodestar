import path from "node:path";
import {describe, it, beforeAll, afterAll, vi, onTestFinished} from "vitest";
import {retry} from "@lodestar/utils";
import {getClient} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {interopSecretKey, interopSecretKeys} from "@lodestar/state-transition";
import {
  spawnCliCommand,
  execCliCommand,
  startExternalSigner,
  StartedExternalSigner,
  getKeystoresStr,
  stopChildProcess,
} from "@lodestar/test-utils";
import {testFilesDir} from "../utils.js";

describe("voluntaryExit using remote signer", function () {
  vi.setConfig({testTimeout: 30_000});

  let externalSigner: StartedExternalSigner;

  beforeAll(async () => {
    const password = "password";
    externalSigner = await startExternalSigner({
      keystoreStrings: await getKeystoresStr(
        password,
        interopSecretKeys(2).map((k) => k.toHex())
      ),
      password: password,
    });
  });

  afterAll(async () => {
    await externalSigner.container.stop();
  });

  it("Perform a voluntary exit", async () => {
    const restPort = 9596;
    const devBnProc = await spawnCliCommand(
      "packages/cli/bin/lodestar.js",
      [
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
      ],
      {pipeStdioToParent: false, logPrefix: "dev"}
    );
    onTestFinished(async () => {
      await stopChildProcess(devBnProc);
    });

    // Exit early if process exits
    devBnProc.on("exit", (code) => {
      if (code !== null && code > 0) {
        throw new Error(`devBnProc process exited with code ${code}`);
      }
    });

    const baseUrl = `http://127.0.0.1:${restPort}`;
    const client = getClient({baseUrl}, {config});

    // Wait for beacon node API to be available + genesis
    await retry(
      async () => {
        const head = (await client.beacon.getBlockHeader({blockId: "head"})).value();
        if (head.header.message.slot < 1) throw Error("pre-genesis");
      },
      {retryDelay: 1000, retries: 20}
    );

    const indexesToExit = [0, 1];
    const pubkeysToExit = indexesToExit.map((i) => interopSecretKey(i).toPublicKey().toHex());

    await execCliCommand(
      "packages/cli/bin/lodestar.js",
      [
        "validator",
        "voluntary-exit",
        "--network=dev",
        "--yes",
        `--externalSigner.url=${externalSigner.url}`,
        "--externalSigner.fetch=true",
        `--server=${baseUrl}`,
        `--pubkeys=${pubkeysToExit.join(",")}`,
      ],
      {pipeStdioToParent: false, logPrefix: "voluntary-exit"}
    );

    for (const pubkey of pubkeysToExit) {
      await retry(
        async () => {
          const validator = (await client.beacon.getStateValidator({stateId: "head", validatorId: pubkey})).value();
          if (validator.status !== "active_exiting") {
            throw Error("Validator not exiting");
          } else {
            console.log(`Confirmed validator ${pubkey} = ${validator.status}`);
          }
        },
        {retryDelay: 1000, retries: 20}
      );
    }
  });
});
