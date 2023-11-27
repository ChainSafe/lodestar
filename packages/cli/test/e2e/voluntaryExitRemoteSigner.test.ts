import path from "node:path";
import fs from "node:fs";
import {GenericContainer, Wait, StartedTestContainer} from "testcontainers";
import tmp from "tmp";
import {retry} from "@lodestar/utils";
import {ApiError, getClient} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {interopSecretKey, interopSecretKeys} from "@lodestar/state-transition";
import {spawnCliCommand, execCliCommand} from "@lodestar/test-utils";
import {getMochaContext} from "@lodestar/test-utils/mocha";
import {testFilesDir} from "../utils.js";
import {getKeystoresStr} from "../utils/keystores.js";

let web3signerUrl: string;
// using the latest image to be alerted in case there is a breaking change
const web3signerVersion = "23.11.0";

describe("voluntaryExit using remote signer", function () {
  const testContext = getMochaContext(this);
  this.timeout("60s");

  let startedContainer: StartedTestContainer;

  after("stop web3signer container", async function () {
    await startedContainer.stop();
  });

  before("start web3signer container", async function () {
    this.timeout("300s");
    // path to store configuration
    const tmpDir = tmp.dirSync({
      unsafeCleanup: true,
      // In Github runner NodeJS process probably runs as root, so web3signer doesn't have permissions to read config dir
      mode: 755,
    });
    // Apply permissions again to hopefully make Github runner happy >.<
    fs.chmodSync(tmpDir.name, 0o755);

    const configDirPathHost = tmpDir.name;
    const configDirPathContainer = "/var/web3signer/config";

    // keystore content and file paths
    const passwordFilename = "password.txt";
    const password = "password";

    const keystoreStrings = await getKeystoresStr(
      password,
      interopSecretKeys(2).map((key) => key.toHex())
    );

    for (const [idx, keystoreString] of keystoreStrings.entries()) {
      fs.writeFileSync(path.join(configDirPathHost, `keystore-${idx}.json`), keystoreString);
    }
    fs.writeFileSync(path.join(configDirPathHost, passwordFilename), password);
    const port = 9000;

    startedContainer = await new GenericContainer(`consensys/web3signer:${web3signerVersion}`)
      .withHealthCheck({
        test: ["CMD-SHELL", `curl -f http://localhost:${port}/healthcheck || exit 1`],
        interval: 1000,
        timeout: 3000,
        retries: 5,
        startPeriod: 1000,
      })
      .withWaitStrategy(Wait.forHealthCheck())
      .withExposedPorts(port)
      .withBindMounts([{source: configDirPathHost, target: configDirPathContainer, mode: "ro"}])
      .withCommand([
        "eth2",
        `--keystores-path=${configDirPathContainer}`,
        // Don't use path.join here, the container is running on unix filesystem
        `--keystores-password-file=${configDirPathContainer}/${passwordFilename}`,
        "--slashing-protection-enabled=false",
      ])
      .start();

    web3signerUrl = `http://localhost:${startedContainer.getMappedPort(port)}`;

    const stream = await startedContainer.logs();
    stream
      .on("data", (line) => process.stdout.write(line))
      .on("err", (line) => process.stderr.write(line))
      // eslint-disable-next-line no-console
      .on("end", () => console.log("Stream closed"));
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
      {pipeStdioToParent: false, logPrefix: "dev", testContext}
    );

    // Exit early if process exits
    devBnProc.on("exit", (code) => {
      if (code !== null && code > 0) {
        throw new Error(`devBnProc process exited with code ${code}`);
      }
    });

    const baseUrl = `http://127.0.0.1:${restPort}`;
    // To cleanup the event stream connection
    const httpClientController = new AbortController();
    const client = getClient({baseUrl, getAbortSignal: () => httpClientController.signal}, {config});

    // Wait for beacon node API to be available + genesis
    await retry(
      async () => {
        const head = await client.beacon.getBlockHeader("head");
        ApiError.assert(head);
        if (head.response.data.header.message.slot < 1) throw Error("pre-genesis");
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
        `--externalSigner.url=${web3signerUrl}`,
        "--externalSigner.fetch=true",
        `--server=${baseUrl}`,
        `--pubkeys=${pubkeysToExit.join(",")}`,
      ],
      {pipeStdioToParent: false, logPrefix: "voluntary-exit"}
    );

    for (const pubkey of pubkeysToExit) {
      await retry(
        async () => {
          const res = await client.beacon.getStateValidator("head", pubkey);
          ApiError.assert(res);
          if (res.response.data.status !== "active_exiting") {
            throw Error("Validator not exiting");
          } else {
            // eslint-disable-next-line no-console
            console.log(`Confirmed validator ${pubkey} = ${res.response.data.status}`);
          }
        },
        {retryDelay: 1000, retries: 20}
      );
    }

    // Disconnect the event stream for the client
    httpClientController.abort();
  });
});
