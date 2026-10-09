import {describe, expect, it} from "vitest";
import {ProgressiveContainerType} from "@chainsafe/ssz";
import {ssz} from "../../../src/index.js";

describe("Heze EIP-8015 SSZ types", () => {
  it("removes legacy Eth1 fields from BeaconState without moving surviving gindices", () => {
    const type = ssz.heze.BeaconState;
    expect(type).toBeInstanceOf(ProgressiveContainerType);
    expect(type.activeFields.toBoolArray()).toEqual(
      Array.from({length: 46}, (_, index) => ![8, 9, 10, 28].includes(index))
    );
    for (const field of ["eth1Data", "eth1DataVotes", "eth1DepositIndex", "depositRequestsStartIndex"]) {
      expect(Object.hasOwn(type.fields, field), field).toBe(false);
    }
    for (const field of Object.keys(type.fields)) {
      expect(type.getPathInfo([field]).gindex, field).toBe(ssz.gloas.BeaconState.getPathInfo([field]).gindex);
    }
  });

  it("removes eth1Data and deposits from BeaconBlockBody without moving surviving gindices", () => {
    const type = ssz.heze.BeaconBlockBody;
    expect(type.activeFields.toBoolArray()).toEqual(Array.from({length: 13}, (_, index) => ![1, 6].includes(index)));
    for (const field of ["eth1Data", "deposits"]) {
      expect(Object.hasOwn(type.fields, field), field).toBe(false);
    }
    for (const field of Object.keys(type.fields)) {
      expect(type.getPathInfo([field]).gindex, field).toBe(ssz.gloas.BeaconBlockBody.getPathInfo([field]).gindex);
    }
  });

  it("round-trips state and block through serialize, tree view and json", () => {
    const state = ssz.heze.BeaconState.defaultValue();
    state.validators = [ssz.phase0.Validator.defaultValue()];
    state.balances = [32e9];
    state.inactivityScores = [1];
    state.depositBalanceToConsume = 123n;
    const bytes = ssz.heze.BeaconState.serialize(state);
    expect(ssz.heze.BeaconState.equals(ssz.heze.BeaconState.deserialize(bytes), state)).toBe(true);
    const view = ssz.heze.BeaconState.deserializeToViewDU(bytes);
    expect(view.hashTreeRoot()).toEqual(ssz.heze.BeaconState.hashTreeRoot(state));

    const block = ssz.heze.SignedBeaconBlock.defaultValue();
    block.message.body.voluntaryExits.push(ssz.phase0.SignedVoluntaryExit.defaultValue());
    const blockBytes = ssz.heze.SignedBeaconBlock.serialize(block);
    expect(ssz.heze.SignedBeaconBlock.deserialize(blockBytes)).toEqual(block);
    const json = ssz.heze.SignedBeaconBlock.toJson(block) as {message: {body: Record<string, unknown>}};
    expect(ssz.heze.SignedBeaconBlock.fromJson(json)).toEqual(block);
    expect(json.message.body).not.toHaveProperty("eth1_data");
    expect(json.message.body).not.toHaveProperty("deposits");
  });

  it("keeps spec chunk positions and shrinks the fixed layout by exactly the removed fields", () => {
    expect(ssz.heze.BeaconState.fieldsEntries.map((entry) => entry.chunkIndex)).toEqual(
      Array.from({length: 46}, (_, index) => index).filter((index) => ![8, 9, 10, 28].includes(index))
    );
    expect(ssz.heze.BeaconBlockBody.fieldsEntries.map((entry) => entry.chunkIndex)).toEqual(
      Array.from({length: 13}, (_, index) => index).filter((index) => ![1, 6].includes(index))
    );
    // eth1Data (72) + eth1DataVotes offset (4) + eth1DepositIndex (8) + depositRequestsStartIndex (8)
    expect(ssz.gloas.BeaconState.fixedEnd - ssz.heze.BeaconState.fixedEnd).toBe(92);
    // eth1Data (72) + deposits offset (4)
    expect(ssz.gloas.BeaconBlockBody.fixedEnd - ssz.heze.BeaconBlockBody.fixedEnd).toBe(76);
  });
});
