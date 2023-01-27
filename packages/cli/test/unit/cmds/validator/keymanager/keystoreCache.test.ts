import fs from "node:fs";
import {randomBytes} from "node:crypto";
import tmp from "tmp";
import {expect} from "chai";
import chainAsPromised from "chai-as-promised";
import chai from "chai";
import {Keystore} from "@chainsafe/bls-keystore";
import {interopSecretKey} from "@lodestar/state-transition";
import bls from "@chainsafe/bls";
import {SignerLocal, SignerType} from "@lodestar/validator";
import {loadKeystoreCache, writeKeystoreCache} from "../../../../../src/cmds/validator/keymanager/keystoreCache.js";
import {LocalKeystoreDefinition} from "../../../../../src/cmds/validator/keymanager/interface.js";

chai.use(chainAsPromised);

const numberOfSigners = 10;

describe("keystoreCache", () => {
  let definitions: LocalKeystoreDefinition[];
  let signers: SignerLocal[];
  let secretKeys: Uint8Array[];
  let passwords: string[];
  let keystoreCacheFile: string;
  // tmp.setGracefulCleanup();

  beforeEach(async function setup() {
    this.timeout(50000);
    definitions = [];
    signers = [];
    secretKeys = [];
    passwords = [];
    keystoreCacheFile = tmp.tmpNameSync({postfix: ".cache"});

    for (let i = 0; i < numberOfSigners; i++) {
      const secretKey = bls.SecretKey.fromBytes(interopSecretKey(i).toBytes());
      const keystorePath = tmp.tmpNameSync({postfix: ".json"});
      const password = secretKey.toHex();
      const keystore = await Keystore.create(
        password,
        secretKey.toBytes(),
        secretKey.toPublicKey().toBytes(),
        keystorePath,
        "test-keystore",
        // To make the test efficient we use a low iteration count
        {
          function: "pbkdf2",
          params: {dklen: 32, c: 10, prf: "hmac-sha256", salt: randomBytes(32).toString("hex")},
        }
      );
      fs.writeFileSync(keystorePath, keystore.stringify());

      signers.push({type: SignerType.Local, secretKey});

      // Use secretkey hex as password
      definitions.push({password: secretKey.toHex(), keystorePath});
      passwords.push(password);
      secretKeys.push(secretKey.toBytes());
    }
  });

  describe("writeKeystoreCache", () => {
    it("should write a valid keystore cache file", async () => {
      await expect(writeKeystoreCache(keystoreCacheFile, signers, passwords)).to.fulfilled;
      expect(fs.existsSync(keystoreCacheFile)).to.be.true;
    });

    it("should throw error if password length are not same as signers", async () => {
      await expect(writeKeystoreCache(keystoreCacheFile, signers, [passwords[0]])).to.rejectedWith(
        `Number of signers and passwords must be equal. signers=${numberOfSigners}, passwords=1`
      );
    });
  });

  describe("loadKeystoreCache", () => {
    it("should load the valid keystore cache", async () => {
      await writeKeystoreCache(keystoreCacheFile, signers, passwords);
      const result = await loadKeystoreCache(keystoreCacheFile, definitions);

      expect(result.map((r) => r.secretKey.toBytes())).to.eql(secretKeys);
    });

    it("should raise error for mismatch public key", async () => {
      await writeKeystoreCache(keystoreCacheFile, signers, passwords);
      definitions[0].keystorePath = definitions[1].keystorePath;

      await expect(loadKeystoreCache(keystoreCacheFile, definitions)).to.rejected;
    });
  });
});
