import {generateState} from "../../../../utils/state";
import {expect} from "chai";
import sinon from "sinon";
import {List} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/mainnet";
import * as utils from "../../../../../src/util";
import {generateEmptyAttesterSlashing} from "../../../../utils/slashings";
import {phase0} from "../../../../../src";
import {SinonStubFn} from "../../../../utils/types";

describe("process block - attester slashings", function () {
  const sandbox = sinon.createSandbox();
  let state: phase0.BeaconState, attesterSlashing: phase0.AttesterSlashing;

  let isSlashableAttestationStub: SinonStubFn<typeof utils["isSlashableAttestationData"]>,
    validateIndexedAttestationStub: SinonStubFn<typeof utils["isValidIndexedAttestation"]>,
    isSlashableValidatorStub: SinonStubFn<typeof utils["isSlashableValidator"]>,
    slashValidatorStub: SinonStubFn<typeof utils["slashValidator"]>;

  beforeEach(() => {
    isSlashableAttestationStub = sandbox.stub(utils, "isSlashableAttestationData");
    validateIndexedAttestationStub = sandbox.stub(utils, "isValidIndexedAttestation");
    isSlashableValidatorStub = sandbox.stub(utils, "isSlashableValidator");
    slashValidatorStub = sandbox.stub(utils, "slashValidator");
    state = generateState();
    attesterSlashing = generateEmptyAttesterSlashing();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should fail to process slashings - not conflicting", function () {
    isSlashableAttestationStub.returns(false);
    expect(() => phase0.processAttesterSlashing(config, state, attesterSlashing)).to.throw;
  });

  it.skip("should fail to process slashings - data incorrect", function () {
    attesterSlashing.attestation1.signature = Buffer.alloc(96, 1);
    attesterSlashing.attestation2.signature = Buffer.alloc(96, 2);
    isSlashableAttestationStub.returns(true);
    validateIndexedAttestationStub.returns(false);
    try {
      phase0.processAttesterSlashing(config, state, attesterSlashing, true);
      expect.fail();
    } catch (e) {
      expect(validateIndexedAttestationStub.callCount).equals(1);
      expect(
        validateIndexedAttestationStub.getCall(0).calledWithExactly(config, state, attesterSlashing.attestation1, true)
      ).to.be.true;
    }
  });

  it.skip("should fail to process slashings - data2 incorrect", function () {
    attesterSlashing.attestation1.data.source.epoch = 2;
    attesterSlashing.attestation2.data.source.epoch = 3;
    isSlashableAttestationStub.returns(true);
    validateIndexedAttestationStub.withArgs(config, state, attesterSlashing.attestation1).returns(true);
    validateIndexedAttestationStub.withArgs(config, state, attesterSlashing.attestation2).returns(false);
    try {
      phase0.processAttesterSlashing(config, state, attesterSlashing);
      expect.fail();
    } catch (e) {
      expect(validateIndexedAttestationStub.calledOnce).to.be.true;
    }
  });

  it.skip("should fail to process slashings - nothing slashed", function () {
    attesterSlashing.attestation1.data.source.epoch = 2;
    attesterSlashing.attestation2.data.source.epoch = 3;
    isSlashableAttestationStub.returns(true);
    validateIndexedAttestationStub.returns(true);
    try {
      phase0.processAttesterSlashing(config, state, attesterSlashing);
      expect.fail();
    } catch (e) {
      expect(validateIndexedAttestationStub.calledTwice).to.be.true;
    }
  });

  it.skip("should process slashings", function () {
    attesterSlashing.attestation1.attestingIndices = [1, 2, 3] as List<number>;
    attesterSlashing.attestation2.attestingIndices = [2, 3, 4] as List<number>;
    isSlashableAttestationStub.returns(true);
    validateIndexedAttestationStub.returns(true);
    isSlashableValidatorStub.returns(true);
    phase0.processAttesterSlashing(config, state, attesterSlashing);
    expect(slashValidatorStub.calledTwice).to.be.true;
  });
});
