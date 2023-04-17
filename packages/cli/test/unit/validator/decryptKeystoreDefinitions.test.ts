import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import rimraf from "rimraf";
import {expect} from "chai";
import {cachedSeckeysHex} from "../../utils/cachedKeys.js";
import {getKeystoresStr} from "../../utils/keystores.js";
import {testFilesDir} from "../../utils.js";
import {decryptKeystoreDefinitions} from "../../../src/cmds/validator/keymanager/decryptKeystoreDefinitions/index.js";
import {LocalKeystoreDefinition} from "../../../src/cmds/validator/keymanager/interface.js";
import {
  KEYSTORE_MEMORY_USAGE,
  MAX_CONCURRENCY_PER_THREAD,
  MAX_MEMORY_USAGE_PER_THREAD,
  calculateThreadpoolConcurrency,
} from "../../../src/cmds/validator/keymanager/decryptKeystoreDefinitions/poolSize.js";

describe("decryptKeystoreDefinitions", function () {
  this.timeout(100_000);

  const dataDir = path.join(testFilesDir, "decrypt-keystores-test");
  const importFromDir = path.join(dataDir, "eth2.0_deposit_out");

  const password = "AAAAAAAA0000000000";
  const keyCount = 2;
  const secretKeys = cachedSeckeysHex.slice(0, keyCount);

  // Produce and encrypt keystores
  let definitions: LocalKeystoreDefinition[] = [];

  beforeEach("Prepare dataDir", async () => {
    // wipe out data dir and existing keystores
    rimraf.sync(dataDir);
    rimraf.sync(importFromDir);

    fs.mkdirSync(importFromDir, {recursive: true});

    const keystoresStr = await getKeystoresStr(password, secretKeys);
    definitions = [];
    // write keystores to disk
    for (let i = 0; i < keyCount; i++) {
      const keystorePath = path.join(importFromDir, `keystore_${i}.json`);
      fs.writeFileSync(keystorePath, keystoresStr[i]);
      definitions.push({keystorePath, password});
    }
  });

  it("decrypt keystores", async () => {
    const signers = await decryptKeystoreDefinitions(definitions, {logger: console});
    expect(signers.length).to.equal(secretKeys.length);
    for (const signer of signers) {
      const hexSecret = signer.secretKey.toHex();
      expect(secretKeys.includes(hexSecret), `secretKeys doesn't include ${hexSecret}`).to.be.true;
    }
  });

  it("fail to decrypt keystores if lockfiles already exist", async () => {
    await decryptKeystoreDefinitions(definitions, {logger: console});
    // lockfiles should exist after the first run

    try {
      await decryptKeystoreDefinitions(definitions, {logger: console});
      expect.fail("Second decrypt should fail due to failure to get lockfile");
    } catch (e) {
      expect((e as Error).message.startsWith("EEXIST: file already exists"), "Wrong error is thrown").to.be.true;
    }
  });

  it("decrypt keystores if lockfiles already exist if force=true", async () => {
    await decryptKeystoreDefinitions(definitions, {logger: console});
    // lockfiles should exist after the first run

    await decryptKeystoreDefinitions(definitions, {logger: console, ignoreLockFile: true});
  });

  it("calculateThreadpoolConcurrency sanity test", () => {
    const {numWorkers, jobConcurrency} = calculateThreadpoolConcurrency();
    const freeMem = os.freemem() * 0.8;
    expect(jobConcurrency).to.be.lte(MAX_CONCURRENCY_PER_THREAD);
    expect(jobConcurrency * KEYSTORE_MEMORY_USAGE).to.be.lte(MAX_MEMORY_USAGE_PER_THREAD);
    expect(numWorkers * jobConcurrency * KEYSTORE_MEMORY_USAGE).to.be.lte(freeMem);
  });
});
