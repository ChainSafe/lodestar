import fs from "node:fs";
import path from "node:path";
import rimraf from "rimraf";
import {expect} from "chai";
import {testFilesDir} from "../utils.js";
import {describeCliTest, execCli} from "../utils/childprocRunner.js";
import {getAfterEachCallbacks} from "../utils/runUtils.js";
import {cachedPubkeysHex, cachedSeckeysHex} from "../utils/cachedKeys.js";
import {expectKeys, getKeymanagerTestRunner} from "../utils/keymanagerTestRunners.js";
import {getKeystoresStr} from "../utils/keystores.js";

/* eslint-disable no-console */

describeCliTest("import from fs then validate", function ({spawnCli}) {
  const rootDir = path.join(testFilesDir, "import-then-validate-test");
  const importFromDir = path.join(rootDir, "eth2.0_deposit_out");
  const passphraseFilepath = path.join(importFromDir, "password.text");

  before("Clean rootDir", () => {
    rimraf.sync(rootDir);
    rimraf.sync(importFromDir);
  });

  const afterEachCallbacks = getAfterEachCallbacks();
  const itKeymanagerStep = getKeymanagerTestRunner({args: {spawnCli}, afterEachCallbacks, rootDir});

  const passphrase = "AAAAAAAA0000000000";
  const keyCount = 2;
  const pubkeys = cachedPubkeysHex.slice(0, keyCount);
  const secretKeys = cachedSeckeysHex.slice(0, keyCount);

  it("run 'validator import'", async () => {
    // Produce and encrypt keystores
    const keystoresStr = await getKeystoresStr(passphrase, secretKeys);

    fs.mkdirSync(importFromDir, {recursive: true});
    fs.writeFileSync(passphraseFilepath, passphrase);
    for (let i = 0; i < keyCount; i++) {
      fs.writeFileSync(path.join(importFromDir, `keystore_${i}.json`), keystoresStr[i]);
    }

    const stdout = await execCli([
      // ⏎
      "validator import",
      `--rootDir ${rootDir}`,
      `--importKeystoresPath ${importFromDir}`,
      `--importKeystoresPassword ${passphraseFilepath}`,
    ]);

    for (let i = 0; i < keyCount; i++) {
      expect(stdout).includes(pubkeys[i], `stdout should include imported pubkey[${i}]`);
    }
  });

  it("run 'validator list' and check pubkeys are imported", async function () {
    fs.mkdirSync(path.join(rootDir, "keystores"), {recursive: true});
    fs.mkdirSync(path.join(rootDir, "secrets"), {recursive: true});

    const stdout = await execCli([
      // ⏎
      "validator list",
      `--rootDir ${rootDir}`,
    ]);

    for (let i = 0; i < keyCount; i++) {
      expect(stdout).includes(pubkeys[i], `stdout should include imported pubkey[${i}]`);
    }
  });

  itKeymanagerStep("run 'validator' check keys are loaded", async function (keymanagerClient) {
    await expectKeys(keymanagerClient, pubkeys, "Wrong listKeys response data");
  });
});
