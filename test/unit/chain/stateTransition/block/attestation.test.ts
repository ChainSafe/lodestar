import {generateState} from "../../../../utils/state";
import processAttestations, {processAttestation} from "../../../../../src/chain/stateTransition/block/attestations";
import {generateEmptyBlock} from "../../../../utils/block";
import {MAX_ATTESTATIONS, MIN_ATTESTATION_INCLUSION_DELAY, SLOTS_PER_EPOCH} from "../../../../../src/constants";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import {expect} from "chai";
import * as utils from "../../../../../src/chain/stateTransition/util";
import sinon from "sinon";

describe('process block - attestation', function() {

  const sandbox = sinon.createSandbox();

  let attestationSlotStub;

  beforeEach(() => {
    attestationSlotStub = sandbox.stub(utils, 'getAttestationDataSlot');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('fail to process attestations - exceeds maximum', function() {
    const state = generateState();
    const block = generateEmptyBlock();
    block.body.attestations = new Array(MAX_ATTESTATIONS + 1).map(() => {
      return generateEmptyAttestation();
    });
    expect(() => processAttestations(state, block)).to.throw;
  });

  it('fail to process attestation - exceeds inclusion delay', function() {
    const state = generateState({slot: MIN_ATTESTATION_INCLUSION_DELAY + 1});
    const attestation = generateEmptyAttestation();
    attestationSlotStub.returns(0);
    expect(() => processAttestation(state, attestation)).to.throw;
  });

  it('fail to process attestation - future epoch', function() {
    const state = generateState({slot: 0});
    const attestation = generateEmptyAttestation();
    attestationSlotStub.returns(SLOTS_PER_EPOCH + 1);
    expect(() => processAttestation(state, attestation)).to.throw;
  });

  it('should process attestation', function() {
    const state = generateState({slot: 0});
    const attestation = generateEmptyAttestation();
    attestationSlotStub.returns(SLOTS_PER_EPOCH + 1);
    expect(() => processAttestation(state, attestation)).to.throw;
  });

});
