import {describe, expect, it} from "vitest";
import {ProgressiveContainerType} from "@chainsafe/ssz";
import {ssz} from "../../../src/index.js";

describe("Heze EIP-8015 SSZ types", () => {
  it("removes legacy fields without moving the surviving state generalized indices", () => {
    const type = ssz.heze.BeaconState;
    expect(type).toBeInstanceOf(ProgressiveContainerType);
    expect(type.activeFields.toBoolArray()).toEqual(
      Array.from({length: 46}, (_, index) => ![8, 9, 10, 28].includes(index))
    );
    for (const field of ["eth1Data", "eth1DataVotes", "eth1DepositIndex", "depositRequestsStartIndex"]) {
      expect(Object.hasOwn(type.fields, field), field).toBe(false);
      expect(Object.hasOwn(type.defaultValue(), field), field).toBe(false);
      expect(() => type.getPathInfo([field]), field).toThrow();
    }
    for (const field of Object.keys(type.fields)) {
      expect(type.getPathInfo([field]).gindex, field).toBe(ssz.gloas.BeaconState.getPathInfo([field]).gindex);
    }
    expect(type.getPathInfo(["finalizedCheckpoint", "root"]).gindex).toBe(735n);
    expect(type.getPathInfo(["currentSyncCommittee"]).gindex).toBe(2945n);
    expect(type.getPathInfo(["nextSyncCommittee"]).gindex).toBe(2946n);
  });

  it("removes legacy body fields without moving the surviving body generalized indices", () => {
    const type = ssz.heze.BeaconBlockBody;
    expect(type.activeFields.toBoolArray()).toEqual(Array.from({length: 13}, (_, index) => ![1, 6].includes(index)));
    for (const field of ["eth1Data", "deposits"]) {
      expect(Object.hasOwn(type.fields, field), field).toBe(false);
      expect(Object.hasOwn(type.defaultValue(), field), field).toBe(false);
      expect(() => type.getPathInfo([field]), field).toThrow();
    }
    for (const field of Object.keys(type.fields)) {
      expect(type.getPathInfo([field]).gindex, field).toBe(ssz.gloas.BeaconBlockBody.getPathInfo([field]).gindex);
    }
  });

  it("round-trips serialized values and tree views across the removed fields", () => {
    const state = ssz.heze.BeaconState.defaultValue();
    state.validators = [ssz.phase0.Validator.defaultValue()];
    state.balances = [32e9];
    state.inactivityScores = [1];
    state.depositBalanceToConsume = 123n;
    state.latestExecutionPayloadBid.blockHash.fill(1);
    const bytes = ssz.heze.BeaconState.serialize(state);
    expect(ssz.heze.BeaconState.equals(ssz.heze.BeaconState.deserialize(bytes), state)).toBe(true);
    const view = ssz.heze.BeaconState.deserializeToViewDU(bytes);
    expect(ssz.heze.BeaconState.equals(view.toValue(), state)).toBe(true);
    expect(view.hashTreeRoot()).toEqual(ssz.heze.BeaconState.hashTreeRoot(state));

    const block = ssz.heze.SignedBeaconBlock.defaultValue();
    block.message.body.voluntaryExits.push(ssz.phase0.SignedVoluntaryExit.defaultValue());
    block.message.body.signedExecutionPayloadBid.message.blockHash.fill(2);
    const blockBytes = ssz.heze.SignedBeaconBlock.serialize(block);
    expect(ssz.heze.SignedBeaconBlock.deserialize(blockBytes)).toEqual(block);
    expect(ssz.heze.SignedBeaconBlock.deserializeToViewDU(blockBytes).toValue()).toEqual(block);
    const json = ssz.heze.SignedBeaconBlock.toJson(block);
    expect(ssz.heze.SignedBeaconBlock.fromJson(json)).toEqual(block);
    expect(json).not.toHaveProperty("message.body.eth1_data");
    expect(json).not.toHaveProperty("message.body.deposits");
  });
});
