import path from "node:path";
import fs from "node:fs";
import {GenericContainer, Wait, StartedTestContainer} from "testcontainers";
import tmp from "tmp";
import {retry} from "@lodestar/utils";
import {ApiError, getClient} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {interopSecretKey} from "@lodestar/state-transition";
import {spawnCliCommand, execCliCommand} from "@lodestar/test-utils";
import {getMochaContext} from "@lodestar/test-utils/mocha";
import {testFilesDir} from "../utils.js";

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

    const keystoreStrings = getKeystoresToExit();
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

function getKeystoresToExit(): string[] {
  return [
    // eslint-disable-next-line quotes
    `{"crypto": {"kdf": {"function": "scrypt", "params": {"dklen": 32, "n": 262144, "r": 8, "p": 1, "salt": "f75a7a266418913f3094dc6f1286b1cbacd9f1ff7d05413d5f9b289f79b8b53c"}, "message": ""}, "checksum": {"function": "sha256", "params": {}, "message": "5783b95fa51507968d6093a5ededa85e6c9837f85f4a8529f89f6aaeb107b9b8"}, "cipher": {"function": "aes-128-ctr", "params": {"iv": "74d0c19c6e325410cddba27241378ffc"}, "message": "0308b6e1b8b633539c905e739c605e4faa536481f405f8e65647433ae5cffd19"}}, "description": "", "pubkey": "a99a76ed7796f7be22d5b7e85deeb7c5677e88e511e0b337618f8c4eb61349b4bf2d153f649f7b53359fe8b94a38e44c", "path": "m/12381/3600/0/0/0", "uuid": "7903eb75-80a8-461a-87ab-19e0ca3dfeb0", "version": 4}`,
    // eslint-disable-next-line quotes
    `{"crypto": {"kdf": {"function": "scrypt", "params": {"dklen": 32, "n": 262144, "r": 8, "p": 1, "salt": "463e4375b2f09982ad19b53ae83b837d069f85f1c486a4c23b4b604cf4419c54"}, "message": ""}, "checksum": {"function": "sha256", "params": {}, "message": "024caab63a417aa7d8b5863dc5170e73a2a8df77cf9c16ec8b1557f366232617"}, "cipher": {"function": "aes-128-ctr", "params": {"iv": "528e9b03cbec63e8adb238209bef7bcf"}, "message": "fd5f912a4241a02e613e730e527a03840f106c5a37ac994233c5485c61b7cdf4"}}, "description": "", "pubkey": "b89bebc699769726a318c8e9971bd3171297c61aea4a6578a7a4f94b547dcba5bac16a89108b6b6a1fe3695d1a874a0b", "path": "m/12381/3600/0/0/0", "uuid": "f7ce9bcc-aaa1-4023-aec6-1bc03c8af20c", "version": 4}`,
  ];
}
