import path from "node:path";
import {describe, it, expect, beforeAll, vi, onTestFinished} from "vitest";
import {rimraf} from "rimraf";
import {DeletionStatus, getClient, ImportStatus} from "@lodestar/api/keymanager";
import {config} from "@lodestar/config/default";
import {Interchange} from "@lodestar/validator";
import {HttpStatusCode} from "@lodestar/api";
import {bufferStderr, spawnCliCommand} from "@lodestar/test-utils";
import {getKeystoresStr} from "@lodestar/test-utils";
import {testFilesDir} from "../utils.js";
import {cachedPubkeysHex, cachedSeckeysHex} from "../utils/cachedKeys.js";
import {expectDeepEquals} from "../utils/runUtils.js";
import {expectKeys, startValidatorWithKeyManager} from "../utils/validator.js";

describe("import keystores from api", () => {
  vi.setConfig({testTimeout: 30_000});

  const dataDir = path.join(testFilesDir, "import-keystores-test");

  beforeAll(() => {
    rimraf.sync(dataDir);
  });

  /** Generated from  const sk = bls.SecretKey.fromKeygen(Buffer.alloc(32, 0xaa)); */
  const passphrase = "AAAAAAAA0000000000";
  const keyCount = 2;
  const pubkeys = cachedPubkeysHex.slice(0, keyCount);
  const secretKeys = cachedSeckeysHex.slice(0, keyCount);
  const passphrases = pubkeys.map((_) => passphrase);

  const genesisValidatorsRoot = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const slashingProtection: Interchange = {
    metadata: {
      interchange_format_version: "5",
      genesis_validators_root: genesisValidatorsRoot,
    },
    data: [],
  };

  /** From multiple tries, 20_000 results in a JSON of ~ 3MB */
  const SLASHING_PROTECTION_ENTRIES = 20_000;
  for (let i = 0; i < SLASHING_PROTECTION_ENTRIES; i++) {
    slashingProtection.data.push({
      pubkey: "0x" + String(i).padStart(96, "0"),
      signed_blocks: [],
      signed_attestations: [],
    });
    // // Uncomment to test if size is correct
    // if (i % 100 === 0) {
    //   console.log(i, Buffer.from(JSON.stringify(slashingProtection), "utf8").length / 1e6);
    // }
  }

  const slashingProtectionStr = JSON.stringify(slashingProtection);

  it("run 'validator' and import remote keys from API", async () => {
    const {keymanagerClient, stopValidator} = await startValidatorWithKeyManager([], {dataDir});
    onTestFinished(async () => {
      await stopValidator();
    });

    // Produce and encrypt keystores
    const keystoresStr = await getKeystoresStr(passphrase, secretKeys);

    // Assert no keys to start with
    await expectKeys(keymanagerClient, [], "Wrong listKeys before importing");

    // Import test keys
    const importRes = await keymanagerClient.importKeystores({
      keystores: keystoresStr,
      passwords: passphrases,
      slashingProtection: slashingProtectionStr,
    });
    expectDeepEquals(
      importRes.value(),
      pubkeys.map(() => ({status: ImportStatus.imported})),
      "Wrong importKeystores response"
    );

    // Check that keys can be listed
    await expectKeys(keymanagerClient, pubkeys, "Wrong listKeys after importing");

    // Attempt to import the same keys again
    const importAgainRes = await keymanagerClient.importKeystores({
      keystores: keystoresStr,
      passwords: passphrases,
      slashingProtection: slashingProtectionStr,
    });
    expectDeepEquals(
      importAgainRes.value(),
      pubkeys.map(() => ({status: ImportStatus.duplicate})),
      "Wrong importKeystores again response"
    );

    // Attempt to run a second process and expect the keystore lock to throw
    const validator = await spawnCliCommand("packages/cli/bin/lodestar.js", ["validator", "--dataDir", dataDir], {
      logPrefix: "vc-2",
    });

    await new Promise<void>((resolve, reject) => {
      // logger.error is printed to stdout, Yargs errors are printed in stderr
      const vcProc2Stderr = bufferStderr(validator);
      validator.on("exit", (code) => {
        if (code !== null && code > 0) {
          // process should exit with code > 0, and an error related to locks. Sample error:
          // vc 351591:  ✖ Error: '/tmp/tmp-5080-lwNxdM5Ok9ya/import-keystores-test/keystores/0x8be678633e927aa0435addad5dcd5283fef6110d91362519cd6d43e61f6c017d724fa579cc4b2972134e050b6ba120c0/voting-keystore.json' already in use by another process
          // at /home/runner/actions-runner/_work/lodestar/lodestar/node_modules/proper-lockfile/lib/lockfile.js:68:47
          // ... more stack trace
          if (/Error.*voting-keystore\.json' already in use by another process/.test(vcProc2Stderr.read())) {
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

  it("run 'validator' check keys are loaded + delete", async () => {
    const {keymanagerClient, stopValidator} = await startValidatorWithKeyManager([], {dataDir});
    onTestFinished(async () => {
      await stopValidator();
    });
    // Check that keys imported in previous it() are still there
    await expectKeys(keymanagerClient, pubkeys, "Wrong listKeys before deleting");

    // Delete keys
    const deleteRes = await keymanagerClient.deleteKeys({pubkeys});
    expectDeepEquals(
      deleteRes.value().statuses,
      pubkeys.map(() => ({status: DeletionStatus.deleted})),
      "Wrong deleteKeys response"
    );

    // Check keys are deleted
    await expectKeys(keymanagerClient, [], "Wrong listKeys after deleting");
  });

  it("different process check no keys are loaded", async () => {
    const {keymanagerClient, stopValidator} = await startValidatorWithKeyManager([], {dataDir});
    onTestFinished(async () => {
      await stopValidator();
    });

    // After deleting there should be no keys
    await expectKeys(keymanagerClient, [], "Wrong listKeys");
  });

  it("reject calls without bearerToken", async () => {
    const {stopValidator} = await startValidatorWithKeyManager([], {dataDir});
    onTestFinished(async () => {
      await stopValidator();
    });

    const keymanagerClientNoAuth = getClient(
      {baseUrl: "http://localhost:38011", globalInit: {bearerToken: undefined}},
      {config}
    );
    const res = await keymanagerClientNoAuth.listRemoteKeys();
    expect(res.ok).toBe(false);
    expect(res.status).toEqual(HttpStatusCode.UNAUTHORIZED);
  });
});
