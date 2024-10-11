import fs from "node:fs";
import path from "node:path";
import {describe, it, beforeAll, vi} from "vitest";
import {rimraf} from "rimraf";
import {getKeystoresStr} from "@lodestar/test-utils";
import {testFilesDir} from "../utils.js";
import {cachedPubkeysHex, cachedSeckeysHex} from "../utils/cachedKeys.js";
import {expectKeys, startValidatorWithKeyManager} from "../utils/validator.js";

describe("import from fs same cmd as validate", function () {
  vi.setConfig({testTimeout: 30_000});

  const dataDir = path.join(testFilesDir, "import-and-validate-test");
  const importFromDir = path.join(dataDir, "eth2.0_deposit_out");
  const passphraseFilepath = path.join(importFromDir, "password.text");

  beforeAll(async () => {
    rimraf.sync(dataDir);
    rimraf.sync(importFromDir);

    // Produce and encrypt keystores
    const keystoresStr = await getKeystoresStr(passphrase, secretKeys);

    fs.mkdirSync(importFromDir, {recursive: true});
    fs.writeFileSync(passphraseFilepath, passphrase);
    for (let i = 0; i < keyCount; i++) {
      fs.writeFileSync(path.join(importFromDir, `keystore_${i}.json`), keystoresStr[i]);
    }
  });

  const passphrase = "AAAAAAAA0000000000";
  const keyCount = 2;
  const pubkeys = cachedPubkeysHex.slice(0, keyCount);
  const secretKeys = cachedSeckeysHex.slice(0, keyCount);

  // Check that there are not keys loaded without adding extra args `--importKeystores`
  it("run 'validator' there are no keys loaded", async () => {
    const {keymanagerClient, stopValidator} = await startValidatorWithKeyManager([], {
      dataDir,
      logPrefix: "case-1",
    });

    await expectKeys(keymanagerClient, [], "Wrong listKeys response data");
    await stopValidator();
  });

  // Run validator with extra arguments to load keystores in same step
  it("run 'validator' check keys are loaded", async () => {
    const {keymanagerClient, stopValidator} = await startValidatorWithKeyManager(
      [`--importKeystores=${importFromDir}`, `--importKeystoresPassword=${passphraseFilepath}`],
      {dataDir, logPrefix: "case-2"}
    );

    await expectKeys(keymanagerClient, pubkeys, "Wrong listKeys response data");
    await stopValidator();
  });
});
