import fs from "node:fs";
import path from "node:path";
import rimraf from "rimraf";
import {sleep, retry, fromHex} from "@chainsafe/lodestar-utils";
import {Keystore} from "@chainsafe/bls-keystore";
import {Api, DeletionStatus, getClient, ImportStatus} from "@chainsafe/lodestar-api/keymanager";
import {config} from "@chainsafe/lodestar-config/default";
import {Interchange} from "@chainsafe/lodestar-validator";
import {testFilesDir} from "../utils.js";
import {describeCliTest} from "../utils/cliRunner.js";
import {getMockBeaconApiServer} from "../utils/mockBeaconApiServer.js";
import {recursiveLookup} from "../../src/util/fs.js";
import {apiTokenFileName} from "../../src/cmds/validator/keymanager/server.js";
import {pubkeysHex, seckeysHex} from "../utils/cachedKeys.js";
import {expectDeepEquals, getAfterEachCallbacks, itDone} from "../utils/runUtils.js";

describeCliTest("import keystores", function ({spawnCli}) {
  const rootDir = path.join(testFilesDir, "import-keystores-test");

  before("Clean rootDir", () => {
    rimraf.sync(rootDir);
  });

  const afterEachCallbacks = getAfterEachCallbacks();

  /** Generated from  const sk = bls.SecretKey.fromKeygen(Buffer.alloc(32, 0xaa)); */
  const passphrase = "AAAAAAAA0000000000";
  const pubkeys = [pubkeysHex[0], pubkeysHex[1]];
  const passphrases = pubkeys.map((_) => passphrase);

  const genesisValidatorsRoot = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const slashingProtection: Interchange = {
    /* eslint-disable @typescript-eslint/naming-convention */
    metadata: {
      interchange_format_version: "5",
      genesis_validators_root: genesisValidatorsRoot,
    },
    data: [],
  };
  const slashingProtectionStr = JSON.stringify(slashingProtection);

  itKeymanagerStep("run 'validator' and import remote keys via API", async function (keymanagerClient) {
    // Produce and encrypt keystores
    const keystoresStr = await Promise.all(
      pubkeys.map(async (pubkey, i) =>
        (await Keystore.create(passphrase, fromHex(seckeysHex[i]), fromHex(pubkey), "")).stringify()
      )
    );

    // Assert no keys to start with
    await expectKeys(keymanagerClient, [], "Wrong listKeys before importing");

    // Import test keys
    const importRes = await keymanagerClient.importKeystores(keystoresStr, passphrases, slashingProtectionStr);
    expectDeepEquals(
      importRes.data,
      pubkeys.map(() => ({status: ImportStatus.imported})),
      "Wrong importKeystores response"
    );

    // Check that keys can be listed
    await expectKeys(keymanagerClient, pubkeys, "Wrong listKeys after importing");

    // Attempt to import the same keys again
    const importAgainRes = await keymanagerClient.importKeystores(keystoresStr, passphrases, slashingProtectionStr);
    expectDeepEquals(
      importAgainRes.data,
      pubkeys.map(() => ({status: ImportStatus.duplicate})),
      "Wrong importKeystores again response"
    );

    // Attempt to run a second process and expect the key locks to throw
    // TODO
  });

  itKeymanagerStep("run 'validator' check keys are loaded + delete", async function (keymanagerClient) {
    // Check that keys imported in previous it() are still there
    await expectKeys(keymanagerClient, pubkeys, "Wrong listKeys before deleting");

    // Delete keys
    const deleteRes = await keymanagerClient.deleteKeystores(pubkeys);
    expectDeepEquals(
      deleteRes.data,
      pubkeys.map(() => ({status: DeletionStatus.deleted})),
      "Wrong deleteKeystores response"
    );

    // Check keys are deleted
    await expectKeys(keymanagerClient, [], "Wrong listKeys after deleting");
  });

  itKeymanagerStep("different process check no keys are loaded", async function (keymanagerClient) {
    // After deleting there should be no keys
    await expectKeys(keymanagerClient, [], "Wrong listKeys");
  });

  function itKeymanagerStep(itName: string, cb: (this: Mocha.Context, keymanagerClient: Api) => Promise<void>): void {
    itDone(itName, async function (done) {
      this.timeout("60s");

      const keymanagerPort = 38011;
      const beaconPort = 39011;
      const keymanagerUrl = `http://localhost:${keymanagerPort}`;
      const beaconUrl = `http://localhost:${beaconPort}`;

      const beaconServer = getMockBeaconApiServer({port: beaconPort}, {genesisValidatorsRoot});
      afterEachCallbacks.push(() => beaconServer.close());
      await beaconServer.listen();

      const validatorProc = spawnCli([
        // ⏎
        "validator",
        `--rootDir=${rootDir}`,
        "--keymanager.enabled",
        `--keymanager.port=${keymanagerPort}`,
        `--server=${beaconUrl}`,
      ]);
      // Exit early if process exits
      validatorProc.on("exit", (code) => {
        if (code !== null && code > 0) {
          done(Error(`process exited with code ${code}`));
        }
      });

      // Wait for api-token.txt file to be written to disk and find it
      const apiToken = await retry(async () => findApiToken(rootDir), {retryDelay: 500, retries: 10});

      const keymanagerClient = getClient({baseUrl: keymanagerUrl, bearerToken: apiToken}, {config});

      // Wrap in retry since the API may not be listening yet
      await retry(() => keymanagerClient.listKeys(), {retryDelay: 500, retries: 10});

      await cb.bind(this)(keymanagerClient);

      validatorProc.kill("SIGINT");
      await sleep(1000);
      validatorProc.kill("SIGKILL");
    });
  }

  async function expectKeys(keymanagerClient: Api, expectedPubkeys: string[], message: string): Promise<void> {
    const keys = await keymanagerClient.listKeys();
    expectDeepEquals(
      keys.data,
      expectedPubkeys.map((pubkey) => ({validatingPubkey: pubkey, derivationPath: "", readonly: false})),
      message
    );
  }
});

function findApiToken(dirpath: string): string {
  const files = recursiveLookup(dirpath);
  const apiTokenFilepaths = files.filter((filepath) => filepath.endsWith(apiTokenFileName));
  switch (apiTokenFilepaths.length) {
    case 0:
      throw Error(`No api token file found in ${dirpath}`);
    case 1:
      return fs.readFileSync(apiTokenFilepaths[0], "utf8").trim();
    default:
      throw Error(`Too many token files found: ${apiTokenFilepaths.join(" ")}`);
  }
}
