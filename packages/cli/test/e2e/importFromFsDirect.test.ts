import fs from "node:fs";
import path from "node:path";
import {rimraf} from "rimraf";
import {beforeAll, describe, it, vi} from "vitest";
import {getKeystoresStr} from "@lodestar/test-utils";
import {cachedPubkeysHex, cachedSeckeysHex} from "../utils/cachedKeys.js";
import {expectKeys, startValidatorWithKeyManager} from "../utils/validator.js";
import {testFilesDir} from "../utils.js";

describe("import from fs same cmd as validate", () => {
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

describe("import from fs same cmd as validate with per-keystore passwords", () => {
  vi.setConfig({testTimeout: 30_000});

  const dataDir = path.join(testFilesDir, "import-and-validate-multi-password-test");
  const importFromDir = path.join(dataDir, "eth2.0_deposit_out");
  const passwordsDir = path.join(dataDir, "passwords");

  const passphrases = ["AAAAAAAA0000000000", "BBBBBBBB1111111111"];
  const keyCount = passphrases.length;
  const pubkeys = cachedPubkeysHex.slice(0, keyCount);
  const secretKeys = cachedSeckeysHex.slice(0, keyCount);

  beforeAll(async () => {
    rimraf.sync(dataDir);
    rimraf.sync(importFromDir);
    rimraf.sync(passwordsDir);

    const keystoresStr = await Promise.all(
      secretKeys.map(async (secretKey, index) => {
        const [keystoreStr] = await getKeystoresStr(passphrases[index], [secretKey]);
        return keystoreStr;
      })
    );

    fs.mkdirSync(importFromDir, {recursive: true});
    fs.mkdirSync(passwordsDir, {recursive: true});

    for (let i = 0; i < keyCount; i++) {
      fs.writeFileSync(path.join(importFromDir, `keystore_${i}.json`), keystoresStr[i]);
      fs.writeFileSync(path.join(passwordsDir, `${pubkeys[i]}.txt`), passphrases[i]);
    }
  });

  it("run 'validator' with per-keystore password files and check keys are loaded", async () => {
    const {keymanagerClient, stopValidator} = await startValidatorWithKeyManager(
      [`--importKeystores=${importFromDir}`, `--importKeystoresPasswords=${passwordsDir}`],
      {dataDir, logPrefix: "case-3"}
    );

    await expectKeys(keymanagerClient, pubkeys, "Wrong listKeys response data");
    await stopValidator();
  });
});
