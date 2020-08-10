import {generateState} from "../../../../utils/state";
import {expect} from "chai";
import sinon from "sinon";
import {List} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import * as utils from "../../../../../src/util";
import {processAttesterSlashing} from "../../../../../src/block/operations";
import {generateEmptyAttesterSlashing} from "../../../../utils/slashings";

describe("process block - attester slashings", function () {

  const sandbox = sinon.createSandbox();

  let isSlashableAttestationStub: any,
    validateIndexedAttestationStub: any,
    isSlashableValidatorStub: any,
    slashValidatorStub: any;

  beforeEach(() => {
    isSlashableAttestationStub = sandbox.stub(utils, "isSlashableAttestationData");
    validateIndexedAttestationStub = sandbox.stub(utils, "isValidIndexedAttestation");
    isSlashableValidatorStub = sandbox.stub(utils, "isSlashableValidator");
    slashValidatorStub =sandbox.stub(utils, "slashValidator");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should fail to process slashings - not conflicting", function () {
    const state = generateState();
    const attesterSlashing = generateEmptyAttesterSlashing();
    isSlashableAttestationStub.returns(false);
    expect(() => processAttesterSlashing(config, state, attesterSlashing)).to.throw;
  });

  it("should fail to process slashings - data incorrect", function () {
    const state = generateState();
    const attesterSlashing = generateEmptyAttesterSlashing();
    attesterSlashing.attestation1.signature = Buffer.alloc(96, 1);
    attesterSlashing.attestation2.signature = Buffer.alloc(96, 2);
    isSlashableAttestationStub.returns(true);
    validateIndexedAttestationStub.returns(false);
    try {
      processAttesterSlashing(config, state, attesterSlashing, true);
      expect.fail();
    } catch (e) {
      expect(validateIndexedAttestationStub.callCount).equals(1);
      expect(validateIndexedAttestationStub.getCall(0)
        .calledWithExactly(config, state, attesterSlashing.attestation1, true)).to.be.true;
    }
  });

  it("should fail to process slashings - data2 incorrect", function () {
    const state = generateState();
    const attesterSlashing = generateEmptyAttesterSlashing();
    attesterSlashing.attestation1.data.source.epoch = 2;
    attesterSlashing.attestation2.data.source.epoch = 3;
    isSlashableAttestationStub.returns(true);
    validateIndexedAttestationStub.withArgs(state, attesterSlashing.attestation1).returns(true);
    validateIndexedAttestationStub.withArgs(state, attesterSlashing.attestation2).returns(false);
    try {
      processAttesterSlashing(config, state, attesterSlashing);
      expect.fail();
    } catch (e) {
      expect(validateIndexedAttestationStub.calledOnce).to.be.true;
    }

  });

  it("should fail to process slashings - nothing slashed", function () {
    const state = generateState();
    const attesterSlashing = generateEmptyAttesterSlashing();
    attesterSlashing.attestation1.data.source.epoch = 2;
    attesterSlashing.attestation2.data.source.epoch = 3;
    isSlashableAttestationStub.returns(true);
    validateIndexedAttestationStub.returns(true);
    try {
      processAttesterSlashing(config, state, attesterSlashing);
      expect.fail();
    } catch (e) {
      expect(validateIndexedAttestationStub.calledTwice).to.be.true;
    }

  });

  it("should process slashings", function () {
    const state = generateState();
    const attesterSlashing = generateEmptyAttesterSlashing();
    attesterSlashing.attestation1.attestingIndices = [1, 2, 3] as List<number>;
    attesterSlashing.attestation2.attestingIndices = [2, 3, 4] as List<number>;
    isSlashableAttestationStub.returns(true);
    validateIndexedAttestationStub.returns(true);
    isSlashableValidatorStub.returns(true);
    processAttesterSlashing(config, state, attesterSlashing);
    expect(slashValidatorStub.calledTwice).to.be.true;
  });

});
