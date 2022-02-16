import {assert} from "chai";
import sinon from "sinon";
import {KeymanagerApi} from "../../src";
import {Interchange, Validator, ValidatorStore} from "@chainsafe/lodestar-validator";
import {Root} from "@chainsafe/lodestar-types";
import Sinon from "sinon";
import {SlashingProtection} from "@chainsafe/lodestar-validator/src";
import fs from "node:fs";
import {Keystore} from "@chainsafe/bls-keystore";
import lockfile from "lockfile";
import {testLogger} from "@chainsafe/lodestar-validator/test/utils/logger";

describe("keymanager", () => {
  let validatorSub: Sinon.SinonStubbedInstance<Validator>;
  let validatorStoreSub: Sinon.SinonStubbedInstance<ValidatorStore>;
  let slashingProtectionStub: Sinon.SinonStubbedInstance<SlashingProtection>;
  let genesisValidatorRootStub: Sinon.SinonStubbedInstance<Uint8Array | Root>;
  let keystore: Sinon.SinonStubbedInstance<Keystore>;
  const interchange: Interchange = ("abc" as unknown) as Interchange;
  const PASSWORD = "passfortesting";
  // eslint-disable-next-line
  const keyStoreStr = "{\"crypto\": {\"kdf\": {\"function\": \"scrypt\", \"params\": {\"dklen\": 32, \"n\": 262144, \"r\": 8, \"p\": 1, \"salt\": \"34d24f0a6f85b7b55d5ccc54efd0ba2955472a39a72d55e1c71fb770717639de\"}, \"message\": \"\"}, \"checksum\": {\"function\": \"sha256\", \"params\": {}, \"message\": \"c043032c9c50ebcaab5ec6edccad095d223ba5e7be40b2a39b8931ab931585a3\"}, \"cipher\": {\"function\": \"aes-128-ctr\", \"params\": {\"iv\": \"53e5deb6df661b998140ca59de04bd69\"}, \"message\": \"c3fa507c9fdb0bf14983a09175210b6d650d89451bb5a39f368e2f0421db0b14\"}}, \"description\": \"\", \"pubkey\": \"8cd1ea594e011cbdae67c583206aef8661f74a800082079e4edf96b86eb631fff236fcf6b87b57153c26d76c65bc7970\", \"path\": \"m/12381/3600/0/0/0\", \"uuid\": \"a7fa0c0f-edd6-4640-b46d-872db3696a36\", \"version\": 4}";

  beforeEach(() => {
    validatorSub = sinon.createStubInstance(Validator);
    validatorStoreSub = sinon.createStubInstance(ValidatorStore);
    slashingProtectionStub = sinon.createStubInstance(SlashingProtection);
    genesisValidatorRootStub = sinon.createStubInstance(Uint8Array);
    keystore = sinon.createStubInstance(Keystore);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("Keymanager / importKeystores", () => {
    it("should skip adding existing key", (done) => {
      slashingProtectionStub.importInterchange.withArgs(interchange, genesisValidatorRootStub).resolves();
      // stub for duplicate key scenario
      validatorStoreSub.hasVotingPubkey.withArgs(sinon.match.any).returns(true);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (validatorSub as any).validatorStore = validatorStoreSub;

      const km = new KeymanagerApi(
        testLogger(),
        (validatorSub as unknown) as Validator,
        slashingProtectionStub,
        genesisValidatorRootStub
      );

      void km
        .importKeystores([keyStoreStr], [PASSWORD], "")
        .then((result) => {
          assert.equal(result.data.length, 1);
          assert.equal(result.data[0].status, "duplicate");
          done();
        })
        .catch(done);
    });

    it("should add a new key with KeystoresPath given", async () => {
      slashingProtectionStub.importInterchange.withArgs(interchange, genesisValidatorRootStub).resolves();
      validatorStoreSub.hasVotingPubkey.withArgs(sinon.match.any).returns(false);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (validatorSub as any).validatorStore = validatorStoreSub;

      subKeyStore(keystore);

      const fsStub = sinon
        .stub(fs.promises, "writeFile")
        .withArgs(sinon.match(/key_imported/), keyStoreStr, {encoding: "utf8"})
        .resolves();

      const lockStub = sinon
        .stub(lockfile, "lockSync")
        .withArgs(sinon.match(/json.lock/))
        .callsFake(() => {
          return;
        });

      const km = new KeymanagerApi(
        testLogger(),
        (validatorSub as unknown) as Validator,
        slashingProtectionStub,
        genesisValidatorRootStub,
        ["path"]
      );

      const result = await km.importKeystores([keyStoreStr], [PASSWORD], "");
      assert.equal(validatorStoreSub.addSigner.called, true);
      assert.equal(fsStub.called, true);
      assert.equal(lockStub.called, true);
      assert.equal(result.data.length, 1);
      assert.equal(result.data[0].status, "imported");
    });

    it("should add a new key with no KeystoresPath given", async () => {
      slashingProtectionStub.importInterchange.withArgs(interchange, genesisValidatorRootStub).resolves();
      validatorStoreSub.hasVotingPubkey.withArgs(sinon.match.any).returns(false);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (validatorSub as any).validatorStore = validatorStoreSub;
      subKeyStore(keystore);

      const fsStub = sinon
        .stub(fs.promises, "writeFile")
        .withArgs(sinon.match(/key_imported/), keyStoreStr, {encoding: "utf8"})
        .resolves();

      const lockStub = sinon
        .stub(lockfile, "lockSync")
        .withArgs(sinon.match.any)
        .callsFake(() => {
          return;
        });

      const km = new KeymanagerApi(
        testLogger(),
        (validatorSub as unknown) as Validator,
        slashingProtectionStub,
        genesisValidatorRootStub
      );

      const result = await km.importKeystores([keyStoreStr], [PASSWORD], "");
      assert.equal(validatorStoreSub.addSigner.called, true);
      assert.equal(fsStub.called, false);
      assert.equal(lockStub.called, false);
      assert.equal(result.data.length, 1);
      assert.equal(result.data[0].status, "imported");
    });
  });
});

function subKeyStore(keystore: Sinon.SinonStubbedInstance<Keystore>): void {
  sinon.stub(Keystore, "parse").callsFake(() => {
    return keystore;
  });

  keystore.decrypt.withArgs(sinon.match.any).resolves(Buffer.alloc(32, 1));
}
