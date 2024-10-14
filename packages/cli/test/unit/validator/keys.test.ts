import fs from "node:fs";
import path from "node:path";
import {describe, it, expect, afterEach} from "vitest";
import {importKeystoreDefinitionsFromExternalDir} from "../../../src/cmds/validator/signers/importExternalKeystores.js";

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

  function inTmp(filepath: string): string {
    return path.join(tmpDir, filepath);
  }
});
