import {List} from "@chainsafe/ssz";
import {expect} from "chai";
import sinon from "sinon";
import {assembleAttesterDuties} from "../../../../../src/chain/factory/duties";
import {generateCachedState} from "../../../../utils/state";

describe("assemble validator duty", function () {
  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  it("should produce duty (attester and proposer)", function () {
    const publicKey = Buffer.alloc(48, 1);
    const validatorIndex = 2;
    const state = generateCachedState();
    state.epochCtx.getCommitteeAssignment = () => ({
      committeeIndex: 2,
      slot: 1,
      validators: [1, validatorIndex, 5] as List<number>,
    });
    state.epochCtx.getCommitteeCountAtSlot = () => 3;
    const result = assembleAttesterDuties([{pubkey: publicKey, index: validatorIndex}], state.epochCtx, 2);
    if (result === null) throw Error("Result is null");
    expect(result[0].pubkey).to.be.equal(publicKey);
    expect(result[0].slot).to.be.equal(1);
    expect(result[0].committeeIndex).to.be.equal(2);
    expect(result[0].committeesAtSlot).to.be.equal(3);
  });

  it("should produce duty (attester only)", function () {
    const publicKey = Buffer.alloc(48, 1);
    const validatorIndex = 2;
    const state = generateCachedState();
    state.epochCtx.getCommitteeAssignment = () => ({
      committeeIndex: 2,
      slot: 1,
      validators: [1, validatorIndex, 5] as List<number>,
    });
    state.epochCtx.getCommitteeCountAtSlot = () => 3;
    const result = assembleAttesterDuties([{pubkey: publicKey, index: validatorIndex}], state.epochCtx, 3);
    if (result === null) throw Error("Result is null");
    expect(result[0].pubkey).to.be.equal(publicKey);
    expect(result[0].slot).to.be.equal(1);
    expect(result[0].committeeIndex).to.be.equal(2);
    expect(result[0].committeesAtSlot).to.be.equal(3);
  });

  it("should produce empty duty", function () {
    const publicKey = Buffer.alloc(48, 1);
    const validatorIndex = 2;
    const state = generateCachedState();
    state.epochCtx.getCommitteeAssignment = () => null;
    const result = assembleAttesterDuties([{pubkey: publicKey, index: validatorIndex}], state.epochCtx, 3);
    expect(result.length).to.be.equal(0);
  });
});
