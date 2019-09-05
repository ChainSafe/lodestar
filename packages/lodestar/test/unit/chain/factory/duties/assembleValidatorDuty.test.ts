import sinon from "sinon";
import {expect} from "chai";
import {describe} from "mocha";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import * as stateTransitionUtils from "../../../../../src/chain/stateTransition/util";
import {assembleValidatorDuty} from "../../../../../src/chain/factory/duties";
import {generateState} from "../../../../utils/state";

describe("assemble validator duty", function () {

  const sandbox = sinon.createSandbox();
  let committeeAssignmentStub;

  beforeEach(() => {
    committeeAssignmentStub = sandbox.stub(stateTransitionUtils, 'getCommitteeAssignment');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should produce duty (attester and proposer)', function () {
    const publicKey = Buffer.alloc(48, 1);
    const validatorIndex = 2;
    const state = generateState();
    committeeAssignmentStub.returns({shard: 2, slot: 1, validators: [1, validatorIndex, 5]});
    const result = assembleValidatorDuty(config, {publicKey, index: validatorIndex}, state, 2, validatorIndex);
    expect(result).to.not.be.null;
    expect(result.validatorPubkey).to.be.equal(publicKey);
    expect(result.blockProposalSlot).to.be.equal(state.slot);
    expect(result.committeeIndex).to.be.equal(1);
    expect(result.attestationSlot).to.be.equal(1);
    expect(result.attestationShard).to.be.equal(2);
  });

  it('should produce duty (attester only)', function () {
    const publicKey = Buffer.alloc(48, 1);
    const validatorIndex = 2;
    const state = generateState();
    committeeAssignmentStub.returns({shard: 2, slot: 1, validators: [1, validatorIndex, 5]});
    const result = assembleValidatorDuty(config, {publicKey, index: validatorIndex}, state, 3, 99);
    expect(result).to.not.be.null;
    expect(result.validatorPubkey).to.be.equal(publicKey);
    expect(result.blockProposalSlot).to.be.equal(null);
    expect(result.committeeIndex).to.be.equal(1);
    expect(result.attestationSlot).to.be.equal(1);
    expect(result.attestationShard).to.be.equal(2);
  });

  it('should produce empty duty', function () {
    const publicKey = Buffer.alloc(48, 1);
    const validatorIndex = 2;
    const state = generateState();
    committeeAssignmentStub.returns(null);
    const result = assembleValidatorDuty(config, {publicKey, index: validatorIndex}, state, 3, 99);
    expect(result).to.not.be.null;
    expect(result.validatorPubkey).to.be.equal(publicKey);
    expect(result.blockProposalSlot).to.be.equal(null);
    expect(result.committeeIndex).to.be.equal(null);
    expect(result.attestationSlot).to.be.equal(null);
    expect(result.attestationShard).to.be.equal(null);
  });

});
