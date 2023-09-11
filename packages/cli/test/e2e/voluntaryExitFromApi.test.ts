import path from "node:path";
import {expect} from "chai";
import {ApiError, getClient} from "@lodestar/api";
import {getClient as getKeymanagerClient} from "@lodestar/api/keymanager";
import {config} from "@lodestar/config/default";
import {interopSecretKey} from "@lodestar/state-transition";
import {spawnCliCommand} from "@lodestar/test-utils";
import {getMochaContext} from "@lodestar/test-utils/mocha";
import {retry} from "@lodestar/utils";
import {testFilesDir} from "../utils.js";

describe("voluntary exit from api", function () {
  const testContext = getMochaContext(this);
  this.timeout("60s");

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
        "--keymanager.authEnabled=false",
      ],
      {pipeStdioToParent: false, logPrefix: "dev", testContext}
    );

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
        const head = await beaconClient.getBlockHeader("head");
        ApiError.assert(head);
        if (head.response.data.header.message.slot < 1) throw Error("pre-genesis");
      },
      {retryDelay: 1000, retries: 20}
    );

    // 1. create signed voluntary exit message from keymanager
    const exitEpoch = 0;
    const indexToExit = 0;
    const pubkeyToExit = interopSecretKey(indexToExit).toPublicKey().toHex();

    const res = await keymanagerClient.signVoluntaryExit(pubkeyToExit, exitEpoch);
    ApiError.assert(res);
    const signedVoluntaryExit = res.response.data;

    expect(signedVoluntaryExit.message.epoch).to.equal(exitEpoch);
    expect(signedVoluntaryExit.message.validatorIndex).to.equal(indexToExit);
    // Signature will be verified when submitting to beacon node
    expect(signedVoluntaryExit.signature).to.not.be.undefined;

    // 2. submit signed voluntary exit message to beacon node
    ApiError.assert(await beaconClient.submitPoolVoluntaryExit(signedVoluntaryExit));

    // 3. confirm validator status is 'active_exiting'
    await retry(
      async () => {
        const res = await beaconClient.getStateValidator("head", pubkeyToExit);
        ApiError.assert(res);
        if (res.response.data.status !== "active_exiting") {
          throw Error("Validator not exiting");
        } else {
          // eslint-disable-next-line no-console
          console.log(`Confirmed validator ${pubkeyToExit} = ${res.response.data.status}`);
        }
      },
      {retryDelay: 1000, retries: 20}
    );
  });
});
