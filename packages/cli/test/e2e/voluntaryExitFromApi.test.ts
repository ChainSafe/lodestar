import path from "node:path";
import {describe, it, vi, expect, onTestFinished} from "vitest";
import {getClient} from "@lodestar/api";
import {getClient as getKeymanagerClient} from "@lodestar/api/keymanager";
import {config} from "@lodestar/config/default";
import {interopSecretKey} from "@lodestar/state-transition";
import {spawnCliCommand, stopChildProcess} from "@lodestar/test-utils";
import {retry} from "@lodestar/utils";
import {testFilesDir} from "../utils.js";

describe("voluntary exit from api", function () {
  vi.setConfig({testTimeout: 60_000});

  it("Perform a voluntary exit", async () => {
    // Start dev node with keymanager
    const keymanagerPort = 38012;
    const beaconPort = 39012;

    const devProc = await spawnCliCommand(
      "packages/cli/bin/lodestar.js",
      [
        // ⏎
        "dev",
        `--dataDir=${path.join(testFilesDir, "voluntary-exit-api-test")}`,
        "--genesisValidators=8",
        "--startValidators=0..7",
        "--rest",
        `--rest.port=${beaconPort}`,
        `--beaconNodes=http://127.0.0.1:${beaconPort}`,
        // Speed up test to make genesis happen faster
        "--params.SECONDS_PER_SLOT=2",
        // Allow voluntary exists to be valid immediately
        "--params.SHARD_COMMITTEE_PERIOD=0",
        // Enable keymanager API
        "--keymanager",
        `--keymanager.port=${keymanagerPort}`,
        // Disable bearer token auth to simplify testing
        "--keymanager.auth=false",
      ],
      {pipeStdioToParent: false, logPrefix: "dev"}
    );
    onTestFinished(async () => {
      await stopChildProcess(devProc);
    });

    // Exit early if process exits
    devProc.on("exit", (code) => {
      if (code !== null && code > 0) {
        throw new Error(`devProc process exited with code ${code}`);
      }
    });

    const beaconClient = getClient({baseUrl: `http://127.0.0.1:${beaconPort}`}, {config}).beacon;
    const keymanagerClient = getKeymanagerClient({baseUrl: `http://127.0.0.1:${keymanagerPort}`}, {config});

    // Wait for beacon node API to be available + genesis
    await retry(
      async () => {
        const head = (await beaconClient.getBlockHeader({blockId: "head"})).value();
        if (head.header.message.slot < 1) throw Error("pre-genesis");
      },
      {retryDelay: 1000, retries: 20}
    );

    // 1. create signed voluntary exit message from keymanager
    const exitEpoch = 0;
    const indexToExit = 0;
    const pubkeyToExit = interopSecretKey(indexToExit).toPublicKey().toHex();

    const signedVoluntaryExit = (
      await keymanagerClient.signVoluntaryExit({pubkey: pubkeyToExit, epoch: exitEpoch})
    ).value();

    expect(signedVoluntaryExit.message.epoch).toBe(exitEpoch);
    expect(signedVoluntaryExit.message.validatorIndex).toBe(indexToExit);
    // Signature will be verified when submitting to beacon node
    expect(signedVoluntaryExit.signature).toBeDefined();

    // 2. submit signed voluntary exit message to beacon node
    (await beaconClient.submitPoolVoluntaryExit({signedVoluntaryExit})).assertOk();

    // 3. confirm validator status is 'active_exiting'
    await retry(
      async () => {
        const validator = (await beaconClient.getStateValidator({stateId: "head", validatorId: pubkeyToExit})).value();
        if (validator.status !== "active_exiting") {
          throw Error("Validator not exiting");
        }
        console.log(`Confirmed validator ${pubkeyToExit} = ${validator.status}`);
      },
      {retryDelay: 1000, retries: 20}
    );
  });
});
