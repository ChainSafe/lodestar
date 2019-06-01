import {generateState} from "../../../../utils/state";
import {expect} from "chai";
import * as utils from "../../../../../src/chain/stateTransition/util";
import {
  isSlashableValidator,
  slashValidator,
  verifyIndexedAttestation
} from "../../../../../src/chain/stateTransition/util";
import sinon from "sinon";
import {generateEmptyAttesterSlashing} from "../../../../utils/slashings";
import processAttesterSlashings, {processAttesterSlashing} from "../../../../../src/chain/stateTransition/block/attesterSlashings";
import {generateEmptyBlock} from "../../../../utils/block";

describe('process block - attester slashings', function () {

  const sandbox = sinon.createSandbox();

  let isSlashableAttestationStub,
    verifyIndexedAttestationStub,
    isSlashableValidatorStub,
    slashValidatorStub;

  beforeEach(() => {
    isSlashableAttestationStub = sandbox.stub(utils, 'isSlashableAttestationData');
    verifyIndexedAttestationStub = sandbox.stub(utils, 'verifyIndexedAttestation');
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
    verifyIndexedAttestationStub.returns(false);
    try {
      processAttesterSlashing(state, attesterSlashing);
      expect.fail();
    } catch (e) {
      expect(verifyIndexedAttestationStub.calledOnceWith(state, attesterSlashing.attestation1)).to.be.true;
    }
  });

  it('should fail to process slashings - data2 incorrect', function () {
    const state = generateState();
    const attesterSlashing = generateEmptyAttesterSlashing();
    attesterSlashing.attestation1.data.sourceEpoch = 2;
    attesterSlashing.attestation2.data.sourceEpoch = 3;
    isSlashableAttestationStub.returns(true);
    verifyIndexedAttestationStub.withArgs(state, attesterSlashing.attestation1).returns(true);
    verifyIndexedAttestationStub.withArgs(state, attesterSlashing.attestation2).returns(false);
    try {
      processAttesterSlashing(state, attesterSlashing);
      expect.fail();
    } catch (e) {
      expect(verifyIndexedAttestationStub.calledTwice).to.be.true;
    }

  });

  it('should fail to process slashings - nothing slashed', function () {
    const state = generateState();
    const attesterSlashing = generateEmptyAttesterSlashing();
    attesterSlashing.attestation1.data.sourceEpoch = 2;
    attesterSlashing.attestation2.data.sourceEpoch = 3;
    isSlashableAttestationStub.returns(true);
    verifyIndexedAttestationStub.returns(true);
    try {
      processAttesterSlashing(state, attesterSlashing);
      expect.fail();
    } catch (e) {
      expect(verifyIndexedAttestationStub.calledTwice).to.be.true;
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
    verifyIndexedAttestationStub.returns(true);
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
    verifyIndexedAttestationStub.returns(true);
    isSlashableValidatorStub.returns(true);
    processAttesterSlashing(state, attesterSlashing);
    expect(slashValidatorStub.calledThrice).to.be.true;
  });

  it('should process block slashings', function () {
    const state = generateState();
    const attesterSlashing = generateEmptyAttesterSlashing();
    attesterSlashing.attestation1.custodyBit0Indices = [1, 2];
    attesterSlashing.attestation1.custodyBit1Indices = [3];
    attesterSlashing.attestation2.custodyBit0Indices = [1, 2, 3];
    attesterSlashing.attestation2.custodyBit1Indices = [];
    const block = generateEmptyBlock();
    block.body.attesterSlashings.push(attesterSlashing);
    isSlashableAttestationStub.returns(true);
    verifyIndexedAttestationStub.returns(true);
    isSlashableValidatorStub.returns(true);
    processAttesterSlashings(state, block);
    expect(slashValidatorStub.calledThrice).to.be.true;
  });

});
