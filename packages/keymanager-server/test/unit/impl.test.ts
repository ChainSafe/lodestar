import {assert} from "chai";
import sinon from "sinon";
import {KeymanagerApi} from "../../src";
import {Interchange, Validator, ValidatorStore} from "@chainsafe/lodestar-validator";
import {Root} from "@chainsafe/lodestar-types";
import {SecretKeyInfo} from "../../src";
import Sinon from "sinon";
import {SlashingProtection} from "@chainsafe/lodestar-validator/src";
import fs from "node:fs";
import {PublicKey, SecretKey} from "@chainsafe/bls";
import {IInterchangeV5} from "@chainsafe/lodestar-validator/src/slashingProtection/interchange/formats/v5";
import {Keystore} from "@chainsafe/bls-keystore";
import lockfile from "lockfile";

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

  it("should list keys", async () => {
    const importKeystoresPath: string[] = [];
    const secretKeysInfo: SecretKeyInfo[] = [];
    const testPubKey = "0xfff";
    validatorStoreSub.votingPubkeys.returns([testPubKey]);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (validatorSub as any).validatorStore = validatorStoreSub;

    const km = new KeymanagerApi(
      (validatorSub as unknown) as Validator,
      slashingProtectionStub,
      genesisValidatorRootStub,
      importKeystoresPath,
      secretKeysInfo
    );

    const keys = await km.listKeys();

    assert.equal(validatorStoreSub.votingPubkeys.called, true);
    assert.equal(keys.data.length, 1);
    assert.equal(keys.data[0].validatingPubkey, testPubKey);
    assert.equal(keys.data[0].derivationPath, "");
    assert.equal(keys.data[0].readonly, false);
  });

  describe("Keymanager / importKeystores", () => {
    it("should skip adding existing key", (done) => {
      slashingProtectionStub.importInterchange.withArgs(interchange, genesisValidatorRootStub).resolves();
      // stub for duplicate key scenario
      validatorStoreSub.hasVotingPubkey.withArgs(sinon.match.any).returns(true);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (validatorSub as any).validatorStore = validatorStoreSub;

      const km = new KeymanagerApi(
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

  describe("Keymanager / deleteKeystores", () => {
    let secretKeyStub: Sinon.SinonStubbedInstance<SecretKey>;
    let publicKeyStub: Sinon.SinonStubbedInstance<PublicKey>;

    beforeEach(() => {
      secretKeyStub = sinon.createStubInstance(SecretKey);
      publicKeyStub = sinon.createStubInstance(PublicKey);
    });

    afterEach(() => {
      sinon.restore();
    });

    const unlockSecretKeys = sinon.fake();
    const keystorePath = "/path/keystore.json";

    it("should delete keystore", async () => {
      const pubkeyToDelete = [
        "8cd1ea594e011cbdae67c583206aef8661f74a800082079e4edf96b86eb631fff236fcf6b87b57153c26d76c65bc7970",
      ];

      const interchangeStub = makeinterchangeStubFromPubkey(pubkeyToDelete);

      slashingProtectionStub.exportInterchange
        .withArgs(sinon.match.any, sinon.match.any, sinon.match.any)
        .resolves(interchangeStub);

      publicKeyStub.toHex.returns(pubkeyToDelete[0]);
      secretKeyStub.toPublicKey.returns(publicKeyStub);
      validatorStoreSub.removeSigner.withArgs(pubkeyToDelete[0]).returns(true);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (validatorSub as any).validatorStore = validatorStoreSub;

      const fsStub = sinon.stub(fs.promises, "unlink").withArgs(sinon.match.any).resolves();

      const notDeletedPubKeyStub = sinon.createStubInstance(PublicKey);
      notDeletedPubKeyStub.toHex.returns("x0ff");

      const notDeletedSecretKeyStub = sinon.createStubInstance(SecretKey);
      notDeletedSecretKeyStub.toPublicKey.returns(notDeletedPubKeyStub);
      const secondKeyFile = "not_deleted.json";

      const secretKeyInfos: SecretKeyInfo[] = [
        {
          secretKey: secretKeyStub,
          keystorePath,
          unlockSecretKeys,
        },
        {
          secretKey: notDeletedSecretKeyStub,
          keystorePath: secondKeyFile,
          unlockSecretKeys,
        },
      ];

      const km = new KeymanagerApi(
        (validatorSub as unknown) as Validator,
        slashingProtectionStub,
        genesisValidatorRootStub,
        [],
        secretKeyInfos
      );

      const result = await km.deleteKeystores(pubkeyToDelete);
      assert.equal(validatorStoreSub.removeSigner.called, true);
      assert.equal(secretKeyStub.toPublicKey.called, true);
      assert.equal(publicKeyStub.toHex.called, true);
      assert.equal(unlockSecretKeys.called, true);
      assert.equal(fsStub.called, true);
      assert.equal(result.data[0].status, "deleted");
      assert.equal(secretKeyInfos.length, 1);
      assert.equal(
        secretKeyInfos.some((x) => x.keystorePath === secondKeyFile),
        true
      );
      // eslint-disable-next-line
      assert.equal(result.slashingProtection, "{\"data\":[{\"pubkey\":\"8cd1ea594e011cbdae67c583206aef8661f74a800082079e4edf96b86eb631fff236fcf6b87b57153c26d76c65bc7970\",\"signed_blocks\":[],\"signed_attestations\":[]}]}");
    });

    it("should delete not active keystore", async () => {
      const pubkeyToDelete = [
        "8cd1ea594e011cbdae67c583206aef8661f74a800082079e4edf96b86eb631fff236fcf6b87b57153c26d76c65bc7970",
      ];

      const interchangeStub = makeinterchangeStubFromPubkey(pubkeyToDelete);

      slashingProtectionStub.exportInterchange
        .withArgs(sinon.match.any, sinon.match.any, sinon.match.any)
        .resolves(interchangeStub);

      publicKeyStub.toHex.returns(pubkeyToDelete[0]);
      secretKeyStub.toPublicKey.returns(publicKeyStub);
      validatorStoreSub.removeSigner.withArgs(pubkeyToDelete[0]).returns(false);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (validatorSub as any).validatorStore = validatorStoreSub;

      const fsStub = sinon.stub(fs.promises, "unlink").withArgs(sinon.match.any).resolves();

      const secretKeyInfos: SecretKeyInfo[] = [
        {
          secretKey: secretKeyStub,
          keystorePath,
          unlockSecretKeys,
        },
      ];

      const km = new KeymanagerApi(
        (validatorSub as unknown) as Validator,
        slashingProtectionStub,
        genesisValidatorRootStub,
        [],
        secretKeyInfos
      );

      const result = await km.deleteKeystores(pubkeyToDelete);
      assert.equal(validatorStoreSub.removeSigner.called, true);
      assert.equal(secretKeyStub.toPublicKey.called, true);
      assert.equal(publicKeyStub.toHex.called, true);
      assert.equal(unlockSecretKeys.called, true);
      assert.equal(fsStub.called, true);
      assert.equal(result.data[0].status, "not_active");
      // eslint-disable-next-line
      assert.equal(result.slashingProtection, "{\"data\":[{\"pubkey\":\"8cd1ea594e011cbdae67c583206aef8661f74a800082079e4edf96b86eb631fff236fcf6b87b57153c26d76c65bc7970\",\"signed_blocks\":[],\"signed_attestations\":[]}]}");
    });
  });
});

function subKeyStore(keystore: Sinon.SinonStubbedInstance<Keystore>): void {
  sinon.stub(Keystore, "parse").callsFake(() => {
    return keystore;
  });

  keystore.decrypt.withArgs(sinon.match.any).resolves(Buffer.alloc(32, 1));
}

function makeinterchangeStubFromPubkey(pubkeys: string[]): IInterchangeV5 {
  const interchangeStub = <IInterchangeV5>{};

  interchangeStub.data = pubkeys.map((pubkey) => {
    return {
      pubkey,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      signed_blocks: [],
      // eslint-disable-next-line @typescript-eslint/naming-convention
      signed_attestations: [],
    };
  });
  return interchangeStub;
}
