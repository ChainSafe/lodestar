import fs from "node:fs";
import path from "node:path";
import {rimraf} from "rimraf";
import {beforeAll, describe, expect, it, onTestFinished, vi} from "vitest";
import {execCliCommand, getKeystoresStr} from "@lodestar/test-utils";
import {cachedPubkeysHex, cachedSeckeysHex} from "../utils/cachedKeys.js";
import {expectKeys, startValidatorWithKeyManager} from "../utils/validator.js";
import {testFilesDir} from "../utils.js";

describe("import from fs then validate", () => {
  vi.setConfig({testTimeout: 30_000});

  const dataDir = path.join(testFilesDir, "import-then-validate-test");
  const importFromDir = path.join(dataDir, "eth2.0_deposit_out");
  const passphraseFilepath = path.join(importFromDir, "password.text");

  beforeAll(() => {
    rimraf.sync(dataDir);
    rimraf.sync(importFromDir);
  });

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

    const stdout = await execCliCommand("packages/cli/bin/lodestar.js", [
      "validator import",
      `--dataDir ${dataDir}`,
      `--importKeystores ${importFromDir}`,
      `--importKeystoresPassword ${passphraseFilepath}`,
    ]);

    for (let i = 0; i < keyCount; i++) {
      expect(stdout).toContain(pubkeys[i]);
    }
  });

  it("run 'validator list' and check pubkeys are imported", async () => {
    fs.mkdirSync(path.join(dataDir, "keystores"), {recursive: true});
    fs.mkdirSync(path.join(dataDir, "secrets"), {recursive: true});

    const stdout = await execCliCommand("packages/cli/bin/lodestar.js", ["validator list", `--dataDir ${dataDir}`]);

    for (let i = 0; i < keyCount; i++) {
      expect(stdout).toContain(pubkeys[i]);
    }
  });

  it("run 'validator' check keys are loaded", async () => {
    const {keymanagerClient, stopValidator} = await startValidatorWithKeyManager([], {dataDir});
    onTestFinished(async () => {
      await stopValidator();
    });

    await expectKeys(keymanagerClient, pubkeys, "Wrong listKeys response data");
  });
});

describe("import from fs then validate with per-keystore passwords", () => {
  vi.setConfig({testTimeout: 30_000});

  const dataDir = path.join(testFilesDir, "import-then-validate-multi-password-test");
  const importFromDir = path.join(dataDir, "eth2.0_deposit_out");
  const passwordsDir = path.join(dataDir, "passwords");

  const passphrases = ["AAAAAAAA0000000000", "BBBBBBBB1111111111"];
  const keyCount = passphrases.length;
  const pubkeys = cachedPubkeysHex.slice(0, keyCount);
  const secretKeys = cachedSeckeysHex.slice(0, keyCount);

  beforeAll(() => {
    rimraf.sync(dataDir);
    rimraf.sync(importFromDir);
    rimraf.sync(passwordsDir);
  });

  it("run 'validator import' with per-keystore password files", async () => {
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

    const stdout = await execCliCommand("packages/cli/bin/lodestar.js", [
      "validator import",
      `--dataDir ${dataDir}`,
      `--importKeystores ${importFromDir}`,
      `--importKeystoresPasswords ${passwordsDir}`,
    ]);

    for (let i = 0; i < keyCount; i++) {
      expect(stdout).toContain(pubkeys[i]);
    }
  });

  it("run 'validator list' and check pubkeys are imported", async () => {
    fs.mkdirSync(path.join(dataDir, "keystores"), {recursive: true});
    fs.mkdirSync(path.join(dataDir, "secrets"), {recursive: true});

    const stdout = await execCliCommand("packages/cli/bin/lodestar.js", ["validator list", `--dataDir ${dataDir}`]);

    for (let i = 0; i < keyCount; i++) {
      expect(stdout).toContain(pubkeys[i]);
    }
  });

  it("run 'validator' check keys are loaded", async () => {
    const {keymanagerClient, stopValidator} = await startValidatorWithKeyManager([], {dataDir});
    onTestFinished(async () => {
      await stopValidator();
    });

    await expectKeys(keymanagerClient, pubkeys, "Wrong listKeys response data");
  });
});

describe("import from fs with per-keystore passwords validation", () => {
  vi.setConfig({testTimeout: 30_000});

  const dataDir = path.join(testFilesDir, "import-multi-password-missing-password-file-test");
  const importFromDir = path.join(dataDir, "eth2.0_deposit_out");
  const passwordsDir = path.join(dataDir, "passwords");

  beforeAll(() => {
    rimraf.sync(dataDir);
    rimraf.sync(importFromDir);
    rimraf.sync(passwordsDir);
  });

  it("run 'validator import' should fail if a per-keystore password file is missing", async () => {
    const passphrase = "AAAAAAAA0000000000";
    const [secretKey] = cachedSeckeysHex;
    const [keystoreStr] = await getKeystoresStr(passphrase, [secretKey]);

    fs.mkdirSync(importFromDir, {recursive: true});
    fs.mkdirSync(passwordsDir, {recursive: true});
    fs.writeFileSync(path.join(importFromDir, "keystore_0.json"), keystoreStr);

    await expect(
      execCliCommand("packages/cli/bin/lodestar.js", [
        "validator import",
        `--dataDir ${dataDir}`,
        `--importKeystores ${importFromDir}`,
        `--importKeystoresPasswords ${passwordsDir}`,
      ])
    ).rejects.toThrow("No password file found for keystore");
  });
});
