import fs from "node:fs";
import {randomBytes} from "node:crypto";
import tmp from "tmp";
import {expect} from "chai";
import chainAsPromised from "chai-as-promised";
import chai from "chai";
import {Keystore} from "@chainsafe/bls-keystore";
import {interopSecretKey} from "@lodestar/state-transition";
import bls from "@chainsafe/bls";
import {loadKeystoreCache, writeKeystoreCache} from "../../../../../src/cmds/validator/keymanager/keystoreCache.js";

chai.use(chainAsPromised);

const numberOfKeystores = 10;

describe("keystoreCache", () => {
  let keystores: Keystore[];
  let secretKeys: Uint8Array[];
  let passwords: string[];
  let keystoreCacheFile: string;
  // tmp.setGracefulCleanup();

  beforeEach(async function setup() {
    this.timeout(50000);
    keystores = [];
    secretKeys = [];
    passwords = [];
    keystoreCacheFile = tmp.tmpNameSync({postfix: ".cache"});

    for (let i = 0; i < numberOfKeystores; i++) {
      const secretKey = bls.SecretKey.fromBytes(interopSecretKey(i).toBytes());
      secretKeys.push(secretKey.toBytes());
      passwords.push(secretKey.toHex());
      keystores.push(
        await Keystore.create(
          passwords[i],
          secretKeys[0],
          secretKey.toPublicKey().toBytes(),
          "custom path",
          "test-keystore",
          // To make the test efficient we use a low iteration count
          {
            function: "pbkdf2",
            params: {dklen: 32, c: 10, prf: "hmac-sha256", salt: randomBytes(32).toString("hex")},
          }
        )
      );
    }
  });

  describe("writeKeystoreCache", () => {
    it("should write a valid keystore cache file", async () => {
      await expect(writeKeystoreCache(keystoreCacheFile, keystores, passwords, secretKeys)).to.fulfilled;
      expect(fs.existsSync(keystoreCacheFile)).to.be.true;
    });

    it("should throw error if password length are not same as keystore", async () => {
      await expect(writeKeystoreCache(keystoreCacheFile, keystores, [passwords[0]], secretKeys)).to.rejectedWith(
        `Number of keystores and passwords must be equal. keystores=${numberOfKeystores}, passwords=1`
      );
    });

    it("should throw error if private keys length are not same as keystore", async () => {
      await expect(writeKeystoreCache(keystoreCacheFile, keystores, passwords, [secretKeys[0]])).to.rejectedWith(
        `Number of keystores and secretkeys must be equal. keystores=${numberOfKeystores}, secretKeys=1`
      );
    });
  });

  describe("loadKeystoreCache", () => {
    it("should load the valid keystore cache", async () => {
      await writeKeystoreCache(keystoreCacheFile, keystores, passwords, secretKeys);
      const result = await loadKeystoreCache(keystoreCacheFile, keystores, passwords);

      expect(result.map((r) => r.secretKey.toBytes())).to.eql(secretKeys);
    });

    it("should throw error if password length are not same as keystore", async () => {
      await writeKeystoreCache(keystoreCacheFile, keystores, passwords, secretKeys);

      await expect(loadKeystoreCache(keystoreCacheFile, keystores, [passwords[0]])).to.rejectedWith(
        `Number of keystores and passwords must be equal. keystores=${numberOfKeystores}, passwords=1`
      );
    });

    it("should raise error for mismatch public key", async () => {
      await writeKeystoreCache(keystoreCacheFile, keystores, passwords, secretKeys);
      const keystore = keystores[0];
      const originalPubKey = keystore.pubkey;
      keystore.pubkey = "123456";

      await expect(loadKeystoreCache(keystoreCacheFile, keystores, passwords)).to.rejectedWith(
        `Keystore ${keystore.uuid} does not match the expected pubkey. expected=0x123456, found=0x${originalPubKey}`
      );
    });
  });
});
