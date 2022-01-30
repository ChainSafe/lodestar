import {assert} from "chai";
import sinon from "sinon";
import {KeymanagerApi} from "../../src";
import {ValidatorStore} from "@chainsafe/lodestar-validator";
import {Root} from "@chainsafe/lodestar-types";
import {SecretKeyInfo} from "../../src/server";
import Sinon from "sinon";
import {SlashingProtection} from "@chainsafe/lodestar-validator/src";

describe("keymanager", () => {
  let validatorStoreSub: Sinon.SinonStubbedInstance<ValidatorStore>;
  let slashingProtectionStub: Sinon.SinonStubbedInstance<SlashingProtection>;
  let genesisValidatorRootStub: Sinon.SinonStubbedInstance<Uint8Array | Root>;

  beforeEach(() => {
    validatorStoreSub = sinon.createStubInstance(ValidatorStore);
    slashingProtectionStub = sinon.createStubInstance(SlashingProtection);
    genesisValidatorRootStub = sinon.createStubInstance(Uint8Array);
  });

  afterEach(() => {
    sinon.restore();
  });

  it("should list keys", async () => {
    const importKeystoresPath: string[] = [];
    const secretKeysInfo: SecretKeyInfo[] = [];
    const testPubKey = "0xfff";
    validatorStoreSub.votingPubkeys.returns([testPubKey]);

    const km = new KeymanagerApi(
      (validatorStoreSub as unknown) as ValidatorStore,
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
});
