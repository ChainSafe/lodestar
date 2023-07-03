import fs from "node:fs";
import path from "node:path";
import {rimraf} from "rimraf";
import {getMochaContext} from "@lodestar/test-utils/mocha";
import {testFilesDir} from "../utils.js";
import {cachedPubkeysHex, cachedSeckeysHex} from "../utils/cachedKeys.js";
import {expectKeys, startValidatorWithKeyManager} from "../utils/validator.js";
import {getKeystoresStr} from "../utils/keystores.js";

describe("import from fs same cmd as validate", function () {
  const testContext = getMochaContext(this);
  this.timeout("30s");

  const dataDir = path.join(testFilesDir, "import-and-validate-test");
  const importFromDir = path.join(dataDir, "eth2.0_deposit_out");
  const passphraseFilepath = path.join(importFromDir, "password.text");

  before("Clean dataDir", () => {
    rimraf.sync(dataDir);
    rimraf.sync(importFromDir);
  });

  const passphrase = "AAAAAAAA0000000000";
  const keyCount = 2;
  const pubkeys = cachedPubkeysHex.slice(0, keyCount);
  const secretKeys = cachedSeckeysHex.slice(0, keyCount);

  before("write keystores to disk", async () => {
    // Produce and encrypt keystores
    const keystoresStr = await getKeystoresStr(passphrase, secretKeys);

    fs.mkdirSync(importFromDir, {recursive: true});
    fs.writeFileSync(passphraseFilepath, passphrase);
    for (let i = 0; i < keyCount; i++) {
      fs.writeFileSync(path.join(importFromDir, `keystore_${i}.json`), keystoresStr[i]);
    }
  });

  // Check that there are not keys loaded without adding extra args `--importKeystores`
  it("run 'validator' there are no keys loaded", async () => {
    const {keymanagerClient} = await startValidatorWithKeyManager([], {
      dataDir,
      logPrefix: "case-1",
      testContext,
    });

    await expectKeys(keymanagerClient, [], "Wrong listKeys response data");
  });

  // Run validator with extra arguments to load keystores in same step
  it("run 'validator' check keys are loaded", async () => {
    const {keymanagerClient} = await startValidatorWithKeyManager(
      [`--importKeystores=${importFromDir}`, `--importKeystoresPassword=${passphraseFilepath}`],
      {dataDir, logPrefix: "case-2", testContext}
    );

    await expectKeys(keymanagerClient, pubkeys, "Wrong listKeys response data");
  });
});
