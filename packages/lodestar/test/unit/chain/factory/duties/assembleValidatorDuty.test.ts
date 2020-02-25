import sinon from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import * as stateTransitionUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/duties";
import {assembleValidatorDuty} from "../../../../../src/chain/factory/duties";
import {generateState} from "../../../../utils/state";

describe("assemble validator duty", function () {

  const sandbox = sinon.createSandbox();
  let committeeAssignmentStub: any;

  beforeEach(() => {
    committeeAssignmentStub = sandbox.stub(stateTransitionUtils, "getCommitteeAssignment");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should produce duty (attester and proposer)", function () {
    const publicKey = Buffer.alloc(48, 1);
    const validatorIndex = 2;
    const state = generateState();
    state.slot = 1;
    committeeAssignmentStub.returns({committeeIndex: 2, slot: 1, validators: [1, validatorIndex, 5]});
    const result = assembleValidatorDuty(config, {publicKey, index: validatorIndex}, state, 2);
    expect(result).to.not.be.null;
    expect(result.validatorPubkey).to.be.equal(publicKey);
    expect(result.attestationSlot).to.be.equal(1);
    expect(result.committeeIndex).to.be.equal(2);
  });

  it("should produce duty (attester only)", function () {
    const publicKey = Buffer.alloc(48, 1);
    const validatorIndex = 2;
    const state = generateState();
    committeeAssignmentStub.returns({committeeIndex: 2, slot: 1, validators: [1, validatorIndex, 5]});
    const result = assembleValidatorDuty(config, {publicKey, index: validatorIndex}, state, 3);
    expect(result).to.not.be.null;
    expect(result.validatorPubkey).to.be.equal(publicKey);
    expect(result.attestationSlot).to.be.equal(1);
    expect(result.committeeIndex).to.be.equal(2);
  });

  it("should produce empty duty", function () {
    const publicKey = Buffer.alloc(48, 1);
    const validatorIndex = 2;
    const state = generateState();
    committeeAssignmentStub.returns(null);
    const result = assembleValidatorDuty(config, {publicKey, index: validatorIndex}, state, 3);
    expect(result).to.not.be.null;
    expect(result.validatorPubkey).to.be.equal(publicKey);
    expect(result.attestationSlot).to.be.equal(null);
    expect(result.committeeIndex).to.be.equal(null);
  });

});
