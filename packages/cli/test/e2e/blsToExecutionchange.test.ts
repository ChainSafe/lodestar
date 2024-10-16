import path from "node:path";
import {describe, it, vi, onTestFinished} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {sleep, retry} from "@lodestar/utils";
import {getClient} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {interopSecretKey} from "@lodestar/state-transition";
import {execCliCommand, spawnCliCommand, stopChildProcess} from "@lodestar/test-utils";
import {testFilesDir} from "../utils.js";

describe("bLSToExecutionChange cmd", () => {
  vi.setConfig({testTimeout: 60_000});

  it("Perform bLSToExecutionChange", async () => {
    const restPort = 9596;

    const devBnProc = await spawnCliCommand(
      "packages/cli/bin/lodestar.js",
      [
        "dev",
        `--dataDir=${path.join(testFilesDir, "dev-bls-to-execution-change")}`,
        "--genesisValidators=8",
        "--startValidators=0..7",
        "--rest",
        `--rest.port=${restPort}`,
        // Speed up test to make genesis happen faster
        "--params.SECONDS_PER_SLOT=2",
      ],
      {pipeStdioToParent: true, logPrefix: "dev"}
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
    // To cleanup the event stream connection
    const httpClientController = new AbortController();
    const client = getClient({baseUrl, globalInit: {signal: httpClientController.signal}}, {config});

    // Wait for beacon node API to be available + genesis
    await retry(
      async () => {
        const head = (await client.beacon.getBlockHeader({blockId: "head"})).value();
        if (head.header.message.slot < 1) throw Error("pre-genesis");
      },
      {retryDelay: 1000, retries: 60}
    );

    const indexesToWithdraw = [0];
    const pubkeysToWithdraw = indexesToWithdraw.map((i) => interopSecretKey(i).toPublicKey().toHex());
    // Currently in dev interop the withdrawals is just set using the validator pvt keys
    const withdrawalsPvtKeys = indexesToWithdraw.map((i) => interopSecretKey(i).toHex());
    const withdrawalsPubKeys = pubkeysToWithdraw;

    // Interop pubkeys
    // 0 0xa99a76ed7796f7be22d5b7e85deeb7c5677e88e511e0b337618f8c4eb61349b4bf2d153f649f7b
    // 1 0xb89bebc699769726a318c8e9971bd3171297c61aea4a6578a7a4f94b547dcba5bac16a89108b6b
    // 2 0xa3a32b0f8b4ddb83f1a0a853d81dd725dfe577d4f4c3db8ece52ce2b026eca84815c1a7e8e92a4
    // 3 0x88c141df77cd9d8d7a71a75c826c41a9c9f03c6ee1b180f3e7852f6a280099ded351b58d66e653

    await execCliCommand("packages/cli/bin/lodestar.js", [
      "validator",
      "bls-to-execution-change",
      "--network=dev",
      `--server=${baseUrl}`,
      `--publicKey=${pubkeysToWithdraw[0]}`,
      `--fromBlsPrivkey=${withdrawalsPvtKeys[0]}`,
      "--toExecutionAddress 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ]);

    const pooledBlsChanges = (await client.beacon.getPoolBLSToExecutionChanges()).value();
    const {message} = pooledBlsChanges[0];
    const {validatorIndex, toExecutionAddress, fromBlsPubkey} = message;
    if (
      validatorIndex !== 0 ||
      (toHexString(toExecutionAddress) !== "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" &&
        toHexString(fromBlsPubkey) !== withdrawalsPubKeys[0])
    ) {
      throw Error("Invalid message generated");
    }

    httpClientController.abort();
    devBnProc.kill("SIGINT");
    await sleep(1000);
    await stopChildProcess(devBnProc, "SIGKILL");
  });
});
