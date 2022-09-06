import path from "node:path";
import rimraf from "rimraf";
import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {DeletionStatus, getClient, ImportStatus} from "@lodestar/api/keymanager";
import {config} from "@lodestar/config/default";
import {Interchange} from "@lodestar/validator";
import {testFilesDir} from "../utils.js";
import {bufferStderr, describeCliTest} from "../utils/childprocRunner.js";
import {cachedPubkeysHex, cachedSeckeysHex} from "../utils/cachedKeys.js";
import {expectDeepEquals, getAfterEachCallbacks} from "../utils/runUtils.js";
import {expectKeys, getKeymanagerTestRunner} from "../utils/keymanagerTestRunners.js";
import {getKeystoresStr} from "../utils/keystores.js";

chai.use(chaiAsPromised);

describeCliTest("import keystores from api", function ({spawnCli}) {
  const dataDir = path.join(testFilesDir, "import-keystores-test");

  before("Clean dataDir", () => {
    rimraf.sync(dataDir);
  });

  const afterEachCallbacks = getAfterEachCallbacks();
  const itKeymanagerStep = getKeymanagerTestRunner({args: {spawnCli}, afterEachCallbacks, dataDir});

  /** Generated from  const sk = bls.SecretKey.fromKeygen(Buffer.alloc(32, 0xaa)); */
  const passphrase = "AAAAAAAA0000000000";
  const keyCount = 2;
  const pubkeys = cachedPubkeysHex.slice(0, keyCount);
  const secretKeys = cachedSeckeysHex.slice(0, keyCount);
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

  itKeymanagerStep("run 'validator' and import remote keys from API", async function (keymanagerClient) {
    // Produce and encrypt keystores
    const keystoresStr = await getKeystoresStr(passphrase, secretKeys);

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

    // Attempt to run a second process and expect the keystore lock to throw
    const vcProc2 = spawnCli([
      // ⏎
      "validator",
      `--dataDir=${dataDir}`,
    ]);

    await new Promise<void>((resolve, reject) => {
      // logger.error is printed to stdout, Yargs errors are printed in stderr
      const vcProc2Stderr = bufferStderr(vcProc2);
      vcProc2.on("exit", (code) => {
        if (code !== null && code > 0) {
          // process should exit with code > 0, and an error related to locks. Sample error:
          // vc 351591:  ✖ Error: EEXIST: file already exists, open '/tmp/tmp-351554-dMctEAj7sJIz/import-keystores-test/keystores/0x8be678633e927aa0435addad5dcd5283fef6110d91362519cd6d43e61f6c017d724fa579cc4b2972134e050b6ba120c0/voting-keystore.json.lock'
          // at Object.openSync (node:fs:585:3)
          // at Module.exports.lockSync (/home/lion/Code/eth2.0/lodestar/node_modules/lockfile/lockfile.js:277:17)
          if (/EEXIST.*voting-keystore\.json\.lock/.test(vcProc2Stderr.read())) {
            resolve();
          } else {
            reject(Error(`Second validator proc exited with unknown error. stderr:\n${vcProc2Stderr.read()}`));
          }
        } else {
          reject(Error("Second validator proc must exit code > 0"));
        }
      });
    });
  });

  itKeymanagerStep("run 'validator' check keys are loaded + delete", async function (keymanagerClient) {
    // Check that keys imported in previous it() are still there
    await expectKeys(keymanagerClient, pubkeys, "Wrong listKeys before deleting");

    // Delete keys
    const deleteRes = await keymanagerClient.deleteKeys(pubkeys);
    expectDeepEquals(
      deleteRes.data,
      pubkeys.map(() => ({status: DeletionStatus.deleted})),
      "Wrong deleteKeys response"
    );

    // Check keys are deleted
    await expectKeys(keymanagerClient, [], "Wrong listKeys after deleting");
  });

  itKeymanagerStep("different process check no keys are loaded", async function (keymanagerClient) {
    // After deleting there should be no keys
    await expectKeys(keymanagerClient, [], "Wrong listKeys");
  });

  itKeymanagerStep("reject calls without bearerToken", async function (_, {keymanagerUrl}) {
    const keymanagerClientNoAuth = getClient({baseUrl: keymanagerUrl, bearerToken: undefined}, {config});
    await expect(keymanagerClientNoAuth.listRemoteKeys()).to.rejectedWith("Unauthorized");
  });
});
