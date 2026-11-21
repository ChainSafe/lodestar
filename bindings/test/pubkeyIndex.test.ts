import {FAR_FUTURE_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {expect, it} from "vitest";
import {SecretKey} from "../src/blst.js";
import bindings from "../src/index.js";
import {pubkeyCache} from "../src/pubkeys.js";
import {createStfState, stfConfig} from "./stfFixture.js";

it("keeps loaded and cloned pubkey indexes local to each state", () => {
  pubkeyCache.reset();
  const value = createStfState();
  const config = new bindings.BeaconConfig(stfConfig, value.genesisValidatorsRoot);
  const anchor = bindings.BeaconStateView.createFromBytes(ssz.fulu.BeaconState.serialize(value), config);
  const states = [anchor];
  try {
    const index = value.validators.length;
    const pubkeyP = SecretKey.fromKeygen(Buffer.alloc(32, 101)).toPublicKey().toBytes();
    const pubkeyQ = SecretKey.fromKeygen(Buffer.alloc(32, 102)).toPublicKey().toBytes();
    value.validators.push({
      ...ssz.phase0.Validator.defaultValue(),
      activationEligibilityEpoch: FAR_FUTURE_EPOCH,
      activationEpoch: FAR_FUTURE_EPOCH,
      exitEpoch: FAR_FUTURE_EPOCH,
      pubkey: pubkeyP,
      withdrawableEpoch: FAR_FUTURE_EPOCH,
    });
    value.balances.push(0);
    value.inactivityScores.push(0);
    value.previousEpochParticipation.push(0);
    value.currentEpochParticipation.push(0);
    const loaded = anchor.loadOtherState(ssz.fulu.BeaconState.serialize(value));
    states.push(loaded);
    const cloned = loaded.processSlots(loaded.slot);
    states.push(cloned);
    value.validators[index].pubkey = pubkeyQ;
    const sibling = loaded.loadOtherState(ssz.fulu.BeaconState.serialize(value));
    states.push(sibling);

    expect(loaded.getValidatorIndex(pubkeyP)).toBe(index);
    expect(cloned.getValidatorIndex(pubkeyP)).toBe(index);
    expect(cloned.getValidatorIndex(pubkeyQ)).toBeNull();
    expect(sibling.getValidatorIndex(pubkeyP)).toBeNull();
    expect(sibling.getValidatorIndex(pubkeyQ)).toBe(index);
    expect(pubkeyCache.size).toBe(index);
    expect(pubkeyCache.getIndex(pubkeyP)).toBeNull();
    expect(pubkeyCache.getIndex(pubkeyQ)).toBeNull();
  } finally {
    for (const state of states) state.release();
    pubkeyCache.reset();
  }
});
