import fs from "node:fs";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {getKeystoresStr} from "@lodestar/test-utils";
import {importKeystoreDefinitionsFromExternalDir} from "../../../src/cmds/validator/signers/importExternalKeystores.js";
import {cachedPubkeysHex, cachedSeckeysHex} from "../../utils/cachedKeys.js";

describe("validator / signers / importKeystoreDefinitionsFromExternalDir", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, {recursive: true});
  });

  it("should filter out deposit data files", () => {
    tmpDir = fs.mkdtempSync("cli-keystores-import-test");

    // Populate dir
    const keystoreFilenames = ["keystore-m_12381_3600_0_0_0-1642090404.json", "key_0.json", "keystore.json"];
    const keystoreNestedFilepaths = keystoreFilenames.map((filename) => path.join("dir1", "dir2", filename));
    const toReadFilepaths = [...keystoreFilenames, ...keystoreNestedFilepaths].map(inTmp);
    const toIgnoreFilepaths = ["deposit_data-1642090404.json", "password.txt"].map(inTmp);

    for (const filepath of [...toReadFilepaths, ...toIgnoreFilepaths]) {
      fs.mkdirSync(path.dirname(filepath), {recursive: true});
      fs.writeFileSync(filepath, "{}");
    }

    const password = "12345678";
    const definitions = importKeystoreDefinitionsFromExternalDir({keystoresPath: [tmpDir], password});

    expect(definitions.map((def) => def.keystorePath).sort()).toEqual(toReadFilepaths.sort());
  });

  it("should throw if a keystores path does not exist", () => {
    tmpDir = fs.mkdtempSync("cli-keystores-import-test");

    const missingKeystorePath = inTmp("missing-validator-keys");

    expect(() =>
      importKeystoreDefinitionsFromExternalDir({keystoresPath: [missingKeystorePath], password: "12345678"})
    ).toThrow("importKeystores must point to an existing file or directory");
  });

  it("should read per-keystore password files from passwords dir", async () => {
    tmpDir = fs.mkdtempSync("cli-keystores-import-test");

    const passphrases = ["AAAAAAAA0000000000", "BBBBBBBB1111111111"];
    const secretKeys = cachedSeckeysHex.slice(0, passphrases.length);
    const pubkeys = cachedPubkeysHex.slice(0, passphrases.length);
    const passwordsDir = inTmp("passwords");
    const keystorePaths = passphrases.map((_, index) => inTmp(`keystore_${index}.json`));
    const keystoresStr = await Promise.all(
      secretKeys.map(async (secretKey, index) => {
        const [keystoreStr] = await getKeystoresStr(passphrases[index], [secretKey]);
        return keystoreStr;
      })
    );

    fs.mkdirSync(passwordsDir, {recursive: true});

    for (const [index, keystorePath] of keystorePaths.entries()) {
      fs.mkdirSync(path.dirname(keystorePath), {recursive: true});
      fs.writeFileSync(keystorePath, keystoresStr[index]);
      fs.writeFileSync(path.join(passwordsDir, `${pubkeys[index]}.txt`), passphrases[index]);
    }

    const definitions = importKeystoreDefinitionsFromExternalDir({keystoresPath: [tmpDir], passwordsDir});

    expect(definitions.sort((a, b) => a.keystorePath.localeCompare(b.keystorePath))).toEqual(
      keystorePaths
        .map((keystorePath, index) => ({
          keystorePath,
          password: passphrases[index],
        }))
        .sort((a, b) => a.keystorePath.localeCompare(b.keystorePath))
    );
  });

  it("should use lowercase per-keystore password filename for mixed-case pubkey keystore", async () => {
    tmpDir = fs.mkdtempSync("cli-keystores-import-test");

    const passphrase = "AAAAAAAA0000000000";
    const [secretKey] = cachedSeckeysHex;
    const [pubkey] = cachedPubkeysHex;
    const [keystoreStr] = await getKeystoresStr(passphrase, [secretKey]);
    const keystorePath = inTmp("keystore_0.json");
    const passwordsDir = inTmp("passwords");

    const keystore = JSON.parse(keystoreStr) as {pubkey: string};
    keystore.pubkey = keystore.pubkey.toUpperCase();

    fs.mkdirSync(passwordsDir, {recursive: true});
    fs.writeFileSync(keystorePath, JSON.stringify(keystore));
    fs.writeFileSync(path.join(passwordsDir, `${pubkey}.txt`), passphrase);

    const definitions = importKeystoreDefinitionsFromExternalDir({keystoresPath: [tmpDir], passwordsDir});

    expect(definitions).toEqual([{keystorePath, password: passphrase}]);
  });

  it("should throw if per-keystore passwords dir does not exist", async () => {
    tmpDir = fs.mkdtempSync("cli-keystores-import-test");

    const passphrase = "AAAAAAAA0000000000";
    const [secretKey] = cachedSeckeysHex;
    const [keystoreStr] = await getKeystoresStr(passphrase, [secretKey]);
    const keystorePath = inTmp("keystore_0.json");
    const passwordsDir = inTmp("missing-passwords");

    fs.writeFileSync(keystorePath, keystoreStr);

    expect(() => importKeystoreDefinitionsFromExternalDir({keystoresPath: [tmpDir], passwordsDir})).toThrow(
      "importKeystoresPasswords must point to an existing directory"
    );
  });

  it("should throw if per-keystore passwords path is not a directory", async () => {
    tmpDir = fs.mkdtempSync("cli-keystores-import-test");

    const passphrase = "AAAAAAAA0000000000";
    const [secretKey] = cachedSeckeysHex;
    const [keystoreStr] = await getKeystoresStr(passphrase, [secretKey]);
    const keystorePath = inTmp("keystore_0.json");
    const passwordsDir = inTmp("passwords.txt");

    fs.writeFileSync(keystorePath, keystoreStr);
    fs.writeFileSync(passwordsDir, passphrase);

    expect(() => importKeystoreDefinitionsFromExternalDir({keystoresPath: [tmpDir], passwordsDir})).toThrow(
      "importKeystoresPasswords must point to a directory"
    );
  });

  it("should throw if per-keystore password file is missing", async () => {
    tmpDir = fs.mkdtempSync("cli-keystores-import-test");

    const passwordsDir = inTmp("passwords");
    const passphrase = "AAAAAAAA0000000000";
    const [secretKey] = cachedSeckeysHex;
    const [keystoreStr] = await getKeystoresStr(passphrase, [secretKey]);
    const keystorePath = inTmp("keystore_0.json");

    fs.mkdirSync(passwordsDir, {recursive: true});
    fs.writeFileSync(keystorePath, keystoreStr);

    expect(() => importKeystoreDefinitionsFromExternalDir({keystoresPath: [tmpDir], passwordsDir})).toThrow(
      "No password file found for keystore"
    );
  });

  it("should include keystore path if a per-keystore keystore file is invalid", () => {
    tmpDir = fs.mkdtempSync("cli-keystores-import-test");

    const passwordsDir = inTmp("passwords");
    const keystorePath = inTmp("keystore_0.json");

    fs.mkdirSync(passwordsDir, {recursive: true});
    fs.writeFileSync(keystorePath, "not-json");

    expect(() => importKeystoreDefinitionsFromExternalDir({keystoresPath: [tmpDir], passwordsDir})).toThrow(
      `Failed to read keystore ${keystorePath}`
    );
  });

  function inTmp(filepath: string): string {
    return path.join(tmpDir, filepath);
  }
});
