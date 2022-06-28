import path from "node:path";
import rimraf from "rimraf";
import {Api, DeleteRemoteKeyStatus, ImportRemoteKeyStatus} from "@chainsafe/lodestar-api/keymanager";
import {testFilesDir} from "../utils.js";
import {describeCliTest} from "../utils/childprocRunner.js";
import {cachedPubkeysHex} from "../utils/cachedKeys.js";
import {expectDeepEquals, getAfterEachCallbacks} from "../utils/runUtils.js";
import {getKeymanagerTestRunner} from "../utils/keymanagerTestRunners.js";

describeCliTest("import remoteKeys from api", function ({spawnCli}) {
  const rootDir = path.join(testFilesDir, "import-remoteKeys-test");

  before("Clean rootDir", () => {
    rimraf.sync(rootDir);
  });

  const afterEachCallbacks = getAfterEachCallbacks();
  const itKeymanagerStep = getKeymanagerTestRunner({args: {spawnCli}, afterEachCallbacks, rootDir});

  /** Generated from  const sk = bls.SecretKey.fromKeygen(Buffer.alloc(32, 0xaa)); */
  const url = "https://remote.signer";
  const pubkeysToAdd = [cachedPubkeysHex[0], cachedPubkeysHex[1]];

  itKeymanagerStep("run 'validator' and import remote keys from API", async function (keymanagerClient) {
    // Wrap in retry since the API may not be listening yet
    await expectKeys(keymanagerClient, [], "Wrong listRemoteKeys before importing");

    // Import test keys
    const importRes = await keymanagerClient.importRemoteKeys(pubkeysToAdd.map((pubkey) => ({pubkey, url})));
    expectDeepEquals(
      importRes.data,
      pubkeysToAdd.map(() => ({status: ImportRemoteKeyStatus.imported})),
      "Wrong importRemoteKeys response"
    );

    // Check that keys can be listed
    await expectKeys(keymanagerClient, pubkeysToAdd, "Wrong listRemoteKeys after importing");

    // Attempt to import the same keys again
    const importAgainRes = await keymanagerClient.importRemoteKeys(pubkeysToAdd.map((pubkey) => ({pubkey, url})));
    expectDeepEquals(
      importAgainRes.data,
      pubkeysToAdd.map(() => ({status: ImportRemoteKeyStatus.duplicate})),
      "Wrong importRemoteKeys again response"
    );
  });

  itKeymanagerStep("run 'validator' check keys are loaded + delete", async function (keymanagerClient) {
    // Check that keys imported in previous it() are still there
    await expectKeys(keymanagerClient, pubkeysToAdd, "Wrong listRemoteKeys before deleting");

    // Delete keys
    const deleteRes = await keymanagerClient.deleteRemoteKeys(pubkeysToAdd);
    expectDeepEquals(
      deleteRes.data,
      pubkeysToAdd.map(() => ({status: DeleteRemoteKeyStatus.deleted})),
      "Wrong deleteRemoteKeys response"
    );

    // Check keys are deleted
    await expectKeys(keymanagerClient, [], "Wrong listRemoteKeys after deleting");
  });

  itKeymanagerStep("different process check no keys are loaded", async function (keymanagerClient) {
    // After deleting there should be no keys
    await expectKeys(keymanagerClient, [], "Wrong listRemoteKeys");
  });

  async function expectKeys(keymanagerClient: Api, expectedPubkeys: string[], message: string): Promise<void> {
    const remoteKeys = await keymanagerClient.listRemoteKeys();
    expectDeepEquals(
      remoteKeys.data,
      expectedPubkeys.map((pubkey) => ({pubkey, url, readonly: false})),
      message
    );
  }
});
