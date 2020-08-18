import sinon from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {assembleAttesterDuty} from "../../../../../src/chain/factory/duties";

describe("assemble validator duty", function () {

  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  it("should produce duty (attester and proposer)", function () {
    const publicKey = Buffer.alloc(48, 1);
    const validatorIndex = 2;
    const epochCtx = new EpochContext(config);
    epochCtx.getCommitteeAssignment = () => ({committeeIndex: 2, slot: 1, validators: [1, validatorIndex, 5]});
    const result = assembleAttesterDuty(config, {publicKey, index: validatorIndex}, epochCtx, 2);
    expect(result).to.not.be.null;
    expect(result.validatorPubkey).to.be.equal(publicKey);
    expect(result.attestationSlot).to.be.equal(1);
    expect(result.committeeIndex).to.be.equal(2);
  });

  it("should produce duty (attester only)", function () {
    const publicKey = Buffer.alloc(48, 1);
    const validatorIndex = 2;
    const epochCtx = new EpochContext(config);
    epochCtx.getCommitteeAssignment = () => ({committeeIndex: 2, slot: 1, validators: [1, validatorIndex, 5]});
    const result = assembleAttesterDuty(config, {publicKey, index: validatorIndex}, epochCtx, 3);
    expect(result).to.not.be.null;
    expect(result.validatorPubkey).to.be.equal(publicKey);
    expect(result.attestationSlot).to.be.equal(1);
    expect(result.committeeIndex).to.be.equal(2);
  });

  it("should produce empty duty", function () {
    const publicKey = Buffer.alloc(48, 1);
    const validatorIndex = 2;
    const epochCtx = new EpochContext(config);
    epochCtx.getCommitteeAssignment = () => (null);
    const result = assembleAttesterDuty(config, {publicKey, index: validatorIndex}, epochCtx, 3);
    expect(result).to.not.be.null;
    expect(result.validatorPubkey).to.be.equal(publicKey);
    expect(result.attestationSlot).to.be.equal(null);
    expect(result.committeeIndex).to.be.equal(null);
  });

});
