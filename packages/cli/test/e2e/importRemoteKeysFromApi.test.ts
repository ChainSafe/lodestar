import path from "node:path";
import rimraf from "rimraf";
import {expect} from "chai";
import {Api, DeleteRemoteKeyStatus, getClient, ImportRemoteKeyStatus} from "@lodestar/api/keymanager";
import {config} from "@lodestar/config/default";
import {testFilesDir} from "../utils.js";
import {describeCliTest} from "../utils/childprocRunner.js";
import {cachedPubkeysHex} from "../utils/cachedKeys.js";
import {expectDeepEquals, getAfterEachCallbacks} from "../utils/runUtils.js";
import {getKeymanagerTestRunner} from "../utils/keymanagerTestRunners.js";

describeCliTest("import remoteKeys from api", function ({spawnCli}) {
  const dataDir = path.join(testFilesDir, "import-remoteKeys-test");

  before("Clean dataDir", () => {
    rimraf.sync(dataDir);
  });

  const afterEachCallbacks = getAfterEachCallbacks();
  const itKeymanagerStep = getKeymanagerTestRunner({args: {spawnCli}, afterEachCallbacks, dataDir});

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

  itKeymanagerStep("reject calls without bearerToken", async function (_, {keymanagerUrl}) {
    const keymanagerClientNoAuth = getClient({baseUrl: keymanagerUrl, bearerToken: undefined}, {config});
    await expect(keymanagerClientNoAuth.listRemoteKeys()).to.rejectedWith("Unauthorized");
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
