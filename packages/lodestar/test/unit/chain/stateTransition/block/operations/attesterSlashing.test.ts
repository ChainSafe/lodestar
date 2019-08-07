import {generateState} from "../../../../../utils/state";
import {expect} from "chai";
import sinon from "sinon";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import * as utils from "../../../../../../src/chain/stateTransition/util";
import {processAttesterSlashing} from "../../../../../../src/chain/stateTransition/block/operations";
import {generateEmptyAttesterSlashing} from "../../../../../utils/slashings";

describe('process block - attester slashings', function () {

  const sandbox = sinon.createSandbox();

  let isSlashableAttestationStub,
    validateIndexedAttestationStub,
    isSlashableValidatorStub,
    slashValidatorStub;

  beforeEach(() => {
    isSlashableAttestationStub = sandbox.stub(utils, 'isSlashableAttestationData');
    validateIndexedAttestationStub = sandbox.stub(utils, 'isValidIndexedAttestation');
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
    expect(() => processAttesterSlashing(config, state, attesterSlashing)).to.throw;
  });

  it('should fail to process slashings - data incorrect', function () {
    const state = generateState();
    const attesterSlashing = generateEmptyAttesterSlashing();
    attesterSlashing.attestation1.signature = Buffer.alloc(96, 1);
    attesterSlashing.attestation2.signature = Buffer.alloc(96, 2);
    isSlashableAttestationStub.returns(true);
    validateIndexedAttestationStub.returns(false);
    try {
      processAttesterSlashing(config, state, attesterSlashing);
      expect.fail();
    } catch (e) {
      expect(validateIndexedAttestationStub.callCount).equals(1);
      expect(validateIndexedAttestationStub.getCall(0)
        .calledWithExactly(config, state, attesterSlashing.attestation1)).to.be.true;
    }
  });

  it('should fail to process slashings - data2 incorrect', function () {
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

  it('should fail to process slashings - nothing slashed', function () {
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
    processAttesterSlashing(config, state, attesterSlashing);
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
    processAttesterSlashing(config, state, attesterSlashing);
    expect(slashValidatorStub.calledThrice).to.be.true;
  });

});
