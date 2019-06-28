import {generateState} from "../../../../utils/state";
import {expect} from "chai";
import * as utils from "../../../../../src/chain/stateTransition/util";
import sinon from "sinon";
import {generateEmptyAttesterSlashing} from "../../../../utils/slashings";
import {processAttesterSlashing} from "../../../../../src/chain/stateTransition/block/operations";

describe('process block - attester slashings', function () {

  const sandbox = sinon.createSandbox();

  let isSlashableAttestationStub,
    validateIndexedAttestationStub,
    isSlashableValidatorStub,
    slashValidatorStub;

  beforeEach(() => {
    isSlashableAttestationStub = sandbox.stub(utils, 'isSlashableAttestationData');
    validateIndexedAttestationStub = sandbox.stub(utils, 'validateIndexedAttestation');
    isSlashableValidatorStub = sandbox.stub(utils, 'isSlashableValidator');
    slashValidatorStub =sandbox.stub(utils, 'slashValidator');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should fail to process slashings - not conflicting', function () {
    const state = generateState();
    const attesterSlashing = generateEmptyAttesterSlashing();
    isSlashableAttestationStub.returns(false);
    expect(() => processAttesterSlashing(state, attesterSlashing)).to.throw;
  });

  it('should fail to process slashings - data incorrect', function () {
    const state = generateState();
    const attesterSlashing = generateEmptyAttesterSlashing();
    attesterSlashing.attestation1.signature = Buffer.alloc(96, 1);
    attesterSlashing.attestation2.signature = Buffer.alloc(96, 2);
    isSlashableAttestationStub.returns(true);
    validateIndexedAttestationStub.returns(false);
    try {
      processAttesterSlashing(state, attesterSlashing);
      expect.fail();
    } catch (e) {
      expect(validateIndexedAttestationStub.callCount).equals(2);
      expect(validateIndexedAttestationStub.getCall(0)
        .calledWithExactly(state, attesterSlashing.attestation1)).to.be.true;
      expect(validateIndexedAttestationStub.getCall(1)
        .calledWithExactly(state, attesterSlashing.attestation2)).to.be.true;
    }
  });

  it('should fail to process slashings - data2 incorrect', function () {
    const state = generateState();
    const attesterSlashing = generateEmptyAttesterSlashing();
    attesterSlashing.attestation1.data.sourceEpoch = 2;
    attesterSlashing.attestation2.data.sourceEpoch = 3;
    isSlashableAttestationStub.returns(true);
    validateIndexedAttestationStub.withArgs(state, attesterSlashing.attestation1).returns(true);
    validateIndexedAttestationStub.withArgs(state, attesterSlashing.attestation2).returns(false);
    try {
      processAttesterSlashing(state, attesterSlashing);
      expect.fail();
    } catch (e) {
      expect(validateIndexedAttestationStub.calledTwice).to.be.true;
    }

  });

  it('should fail to process slashings - nothing slashed', function () {
    const state = generateState();
    const attesterSlashing = generateEmptyAttesterSlashing();
    attesterSlashing.attestation1.data.sourceEpoch = 2;
    attesterSlashing.attestation2.data.sourceEpoch = 3;
    isSlashableAttestationStub.returns(true);
    validateIndexedAttestationStub.returns(true);
    try {
      processAttesterSlashing(state, attesterSlashing);
      expect.fail();
    } catch (e) {
      expect(validateIndexedAttestationStub.calledTwice).to.be.true;
    }

  });

  it('should process slashings', function () {
    const state = generateState();
    const attesterSlashing = generateEmptyAttesterSlashing();
    attesterSlashing.attestation1.custodyBit0Indices = [1, 2];
    attesterSlashing.attestation1.custodyBit1Indices = [];
    attesterSlashing.attestation2.custodyBit0Indices = [1, 2];
    attesterSlashing.attestation2.custodyBit1Indices = [3];
    isSlashableAttestationStub.returns(true);
    validateIndexedAttestationStub.returns(true);
    isSlashableValidatorStub.returns(true);
    processAttesterSlashing(state, attesterSlashing);
    expect(slashValidatorStub.calledTwice).to.be.true;
  });

  it('should process slashings - concatentation test', function () {
    const state = generateState();
    const attesterSlashing = generateEmptyAttesterSlashing();
    attesterSlashing.attestation1.custodyBit0Indices = [1, 2];
    attesterSlashing.attestation1.custodyBit1Indices = [3];
    attesterSlashing.attestation2.custodyBit0Indices = [1, 2, 3];
    attesterSlashing.attestation2.custodyBit1Indices = [];
    isSlashableAttestationStub.returns(true);
    validateIndexedAttestationStub.returns(true);
    isSlashableValidatorStub.returns(true);
    processAttesterSlashing(state, attesterSlashing);
    expect(slashValidatorStub.calledThrice).to.be.true;
  });

});
