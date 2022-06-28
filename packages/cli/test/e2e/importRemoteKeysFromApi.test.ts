import path from "node:path";
import rimraf from "rimraf";
import {sleep, retry} from "@chainsafe/lodestar-utils";
import {Api, DeleteRemoteKeyStatus, getClient, ImportRemoteKeyStatus} from "@chainsafe/lodestar-api/keymanager";
import {config} from "@chainsafe/lodestar-config/default";
import {testFilesDir} from "../utils.js";
import {describeCliTest} from "../utils/childprocRunner.js";
import {getMockBeaconApiServer} from "../utils/mockBeaconApiServer.js";
import {pubkeysHex} from "../utils/cachedKeys.js";
import {expectDeepEquals, findApiToken, getAfterEachCallbacks, itDone} from "../utils/runUtils.js";

describeCliTest("import remoteKeys from api", function ({spawnCli}) {
  const rootDir = path.join(testFilesDir, "import-remoteKeys-test");

  before("Clean rootDir", () => {
    rimraf.sync(rootDir);
  });

  const afterEachCallbacks = getAfterEachCallbacks();

  /** Generated from  const sk = bls.SecretKey.fromKeygen(Buffer.alloc(32, 0xaa)); */
  const url = "https://remote.signer";
  const pubkeysToAdd = [pubkeysHex[0], pubkeysHex[1]];

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

  function itKeymanagerStep(itName: string, cb: (this: Mocha.Context, keymanagerClient: Api) => Promise<void>): void {
    itDone(itName, async function (done) {
      this.timeout("60s");

      const keymanagerPort = 38011;
      const beaconPort = 39011;
      const keymanagerUrl = `http://localhost:${keymanagerPort}`;
      const beaconUrl = `http://localhost:${beaconPort}`;

      const beaconServer = getMockBeaconApiServer({port: beaconPort});
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
      await retry(() => keymanagerClient.listRemoteKeys(), {retryDelay: 500, retries: 10});

      await cb.bind(this)(keymanagerClient);

      validatorProc.kill("SIGINT");
      await sleep(1000);
      validatorProc.kill("SIGKILL");
    });
  }

  async function expectKeys(keymanagerClient: Api, expectedPubkeys: string[], message: string): Promise<void> {
    const remoteKeys = await keymanagerClient.listRemoteKeys();
    expectDeepEquals(
      remoteKeys.data,
      expectedPubkeys.map((pubkey) => ({pubkey, url, readonly: false})),
      message
    );
  }
});
