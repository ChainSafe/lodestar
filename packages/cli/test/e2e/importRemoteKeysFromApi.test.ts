import path from "node:path";
import {describe, it, expect, beforeAll, vi, onTestFinished} from "vitest";
import {rimraf} from "rimraf";
import {ApiClient, DeleteRemoteKeyStatus, getClient, ImportRemoteKeyStatus} from "@lodestar/api/keymanager";
import {config} from "@lodestar/config/default";
import {HttpStatusCode} from "@lodestar/api";
import {testFilesDir} from "../utils.js";
import {cachedPubkeysHex} from "../utils/cachedKeys.js";
import {expectDeepEquals} from "../utils/runUtils.js";
import {startValidatorWithKeyManager} from "../utils/validator.js";

const url = "https://remote.signer";

async function expectKeys(keymanagerClient: ApiClient, expectedPubkeys: string[], message: string): Promise<void> {
  const remoteKeys = (await keymanagerClient.listRemoteKeys()).value();
  expectDeepEquals(
    remoteKeys,
    expectedPubkeys.map((pubkey) => ({pubkey, url, readonly: false})),
    message
  );
}

describe("import remoteKeys from api", () => {
  vi.setConfig({testTimeout: 30_000});

  const dataDir = path.join(testFilesDir, "import-remoteKeys-test");

  beforeAll(() => {
    rimraf.sync(dataDir);
  });

  /** Generated from  const sk = bls.SecretKey.fromKeygen(Buffer.alloc(32, 0xaa)); */
  const pubkeysToAdd = [cachedPubkeysHex[0], cachedPubkeysHex[1]];

  it("run 'validator' and import remote keys from API", async () => {
    const {keymanagerClient, stopValidator} = await startValidatorWithKeyManager([], {dataDir});
    onTestFinished(async () => {
      await stopValidator();
    });

    // Wrap in retry since the API may not be listening yet
    await expectKeys(keymanagerClient, [], "Wrong listRemoteKeys before importing");

    // Import test keys
    const importRes = await keymanagerClient.importRemoteKeys({
      remoteSigners: pubkeysToAdd.map((pubkey) => ({pubkey, url})),
    });
    expectDeepEquals(
      importRes.value(),
      pubkeysToAdd.map(() => ({status: ImportRemoteKeyStatus.imported})),
      "Wrong importRemoteKeys response"
    );

    // Check that keys can be listed
    await expectKeys(keymanagerClient, pubkeysToAdd, "Wrong listRemoteKeys after importing");

    // Attempt to import the same keys again
    const importAgainRes = await keymanagerClient.importRemoteKeys({
      remoteSigners: pubkeysToAdd.map((pubkey) => ({pubkey, url})),
    });
    expectDeepEquals(
      importAgainRes.value(),
      pubkeysToAdd.map(() => ({status: ImportRemoteKeyStatus.duplicate})),
      "Wrong importRemoteKeys again response"
    );
  });

  it("run 'validator' check keys are loaded + delete", async () => {
    const {keymanagerClient, stopValidator} = await startValidatorWithKeyManager([], {dataDir});
    onTestFinished(async () => {
      await stopValidator();
    });

    // Check that keys imported in previous it() are still there
    await expectKeys(keymanagerClient, pubkeysToAdd, "Wrong listRemoteKeys before deleting");

    // Delete keys
    const deleteRes = await keymanagerClient.deleteRemoteKeys({pubkeys: pubkeysToAdd});
    expectDeepEquals(
      deleteRes.value(),
      pubkeysToAdd.map(() => ({status: DeleteRemoteKeyStatus.deleted})),
      "Wrong deleteRemoteKeys response"
    );

    // Check keys are deleted
    await expectKeys(keymanagerClient, [], "Wrong listRemoteKeys after deleting");
  });

  it("reject calls without bearerToken", async () => {
    const {stopValidator} = await startValidatorWithKeyManager([], {dataDir});
    onTestFinished(async () => {
      await stopValidator();
    });

    const keymanagerUrl = "http://localhost:38011";
    const keymanagerClientNoAuth = getClient({baseUrl: keymanagerUrl, globalInit: {bearerToken: undefined}}, {config});
    const res = await keymanagerClientNoAuth.listRemoteKeys();
    expect(res.ok).toBe(false);
    expect(res.status).toEqual(HttpStatusCode.UNAUTHORIZED);
  });
});
