import path from "node:path";
import {expect} from "chai";
import {rimraf} from "rimraf";
import {ApiError, getClient, routes} from "@lodestar/api";
import {Api as KeymanagerApi, getClient as getKeymanagerClient} from "@lodestar/api/keymanager";
import {config} from "@lodestar/config/default";
import {interopSecretKey} from "@lodestar/state-transition";
import {gracefullyStopChildProcess, spawnCliCommand} from "@lodestar/test-utils";
import {phase0} from "@lodestar/types";
import {retry} from "@lodestar/utils";
import {testFilesDir} from "../utils.js";

describe("voluntary exit from api", function () {
  this.timeout("60s");

  const dataDir = path.join(testFilesDir, "voluntary-exit-api-test");

  before("clean dataDir", () => {
    rimraf.sync(dataDir);
  });

  let beaconClient: routes.beacon.Api;
  let keymanagerClient: KeymanagerApi;

  // To cleanup the event stream connection
  const httpClientController = new AbortController();

  let devProc: Awaited<ReturnType<typeof spawnCliCommand>>;

  before("start dev node with keymanager", async () => {
    const keymanagerPort = 38012;
    const beaconPort = 39012;

    devProc = await spawnCliCommand(
      "packages/cli/bin/lodestar.js",
      [
        // ⏎
        "dev",
        `--dataDir=${dataDir}`,
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
      {pipeStdioToParent: false, logPrefix: "dev"}
    );

    // Exit early if process exits
    devProc.on("exit", (code) => {
      if (code !== null && code > 0) {
        throw new Error(`devProc process exited with code ${code}`);
      }
    });

    beaconClient = getClient(
      {baseUrl: `http://127.0.0.1:${beaconPort}`, getAbortSignal: () => httpClientController.signal},
      {config}
    ).beacon;

    keymanagerClient = getKeymanagerClient(
      {baseUrl: `http://127.0.0.1:${keymanagerPort}`, getAbortSignal: () => httpClientController.signal},
      {config}
    );

    // Wait for beacon node API to be available + genesis
    await retry(
      async () => {
        const head = await beaconClient.getBlockHeader("head");
        ApiError.assert(head);
        if (head.response.data.header.message.slot < 1) throw Error("pre-genesis");
      },
      {retryDelay: 1000, retries: 20}
    );
  });

  after(async () => {
    // Disconnect the event stream for the client
    httpClientController.abort();
    devProc.removeAllListeners("exit");
    await gracefullyStopChildProcess(devProc, 3000);
  });

  const exitEpoch = 0;
  const indexToExit = 0;
  const pubkeyToExit = interopSecretKey(indexToExit).toPublicKey().toHex();

  let signedVoluntaryExit: phase0.SignedVoluntaryExit;

  it("1. create signed voluntary exit message from keymanager", async () => {
    const res = await keymanagerClient.signVoluntaryExit(pubkeyToExit, exitEpoch);
    ApiError.assert(res);
    signedVoluntaryExit = res.response.data;

    expect(signedVoluntaryExit.message.epoch).to.equal(exitEpoch);
    expect(signedVoluntaryExit.message.validatorIndex).to.equal(indexToExit);
    // Signature will be verified when submitting to beacon node
    expect(signedVoluntaryExit.signature).to.not.be.undefined;
  });

  it("2. submit signed voluntary exit message to beacon node", async () => {
    ApiError.assert(await beaconClient.submitPoolVoluntaryExit(signedVoluntaryExit));
  });

  it("3. confirm validator status is 'active_exiting'", async () => {
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
