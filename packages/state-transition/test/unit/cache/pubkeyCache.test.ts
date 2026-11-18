import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {FAR_FUTURE_EPOCH} from "@lodestar/params";
import {phase0, ssz} from "@lodestar/types";
import {promoteFinalizedPubkeys} from "../../../src/cache/pubkeyCache.js";
import {IBeaconStateView} from "../../../src/stateView/interface.js";
import {interopSecretKey} from "../../../src/util/interop.js";

function validator(index: number, activationEligibilityEpoch = FAR_FUTURE_EPOCH): phase0.Validator {
  return {
    ...ssz.phase0.Validator.defaultValue(),
    pubkey: interopSecretKey(index).toPublicKey().toBytes(),
    activationEligibilityEpoch,
  };
}

function view(validators: phase0.Validator[]): Pick<IBeaconStateView, "validatorCount" | "getValidator"> {
  return {validatorCount: validators.length, getValidator: (index) => validators[index]};
}

describe("finalized validator pubkeys", () => {
  beforeEach(() => pubkeyCache.reset());
  afterEach(() => pubkeyCache.reset());

  it("promotes the canonical prefix and prunes conflicting candidates only below it", () => {
    const anchor = validator(0, 0);
    const side = validator(1, 5);
    const canonical = validator(2, 5);
    const trailing = validator(3);
    pubkeyCache.append(0, anchor.pubkey);
    pubkeyCache.addCandidate(1, side.pubkey);
    pubkeyCache.addCandidate(1, canonical.pubkey);
    pubkeyCache.addCandidate(2, canonical.pubkey);
    pubkeyCache.addCandidate(2, trailing.pubkey);
    const state = view([anchor, canonical, trailing]);

    promoteFinalizedPubkeys(pubkeyCache, state, 4);
    expect(pubkeyCache.size).toBe(1);

    promoteFinalizedPubkeys(pubkeyCache, state, 5);
    expect(pubkeyCache.size).toBe(2);
    expect(pubkeyCache.getPubkeyBytes(1)).toEqual(canonical.pubkey);
    expect(pubkeyCache.getCandidates(side.pubkey)).toEqual([]);
    expect(pubkeyCache.getCandidates(canonical.pubkey)).toEqual([2]);
    expect(pubkeyCache.getCandidates(trailing.pubkey)).toEqual([2]);
    expect(pubkeyCache.getIndex(trailing.pubkey)).toBeNull();
  });

  it("includes earlier ineligible validators but leaves the trailing ones as candidates", () => {
    const validators = [validator(0, 0), validator(1), validator(2, 3), validator(3)];
    pubkeyCache.append(0, validators[0].pubkey);
    for (let index = 1; index < validators.length; index++) {
      pubkeyCache.addCandidate(index, validators[index].pubkey);
    }

    promoteFinalizedPubkeys(pubkeyCache, view(validators), 3);

    expect(pubkeyCache.size).toBe(3);
    for (let index = 0; index < pubkeyCache.size; index++) {
      expect(pubkeyCache.getPubkeyBytes(index), `pubkey ${index}`).toEqual(validators[index].pubkey);
    }
    expect(pubkeyCache.getCandidates(validators[3].pubkey)).toEqual([3]);
  });

  it("does not shrink the finalized prefix when the state has fewer validators", () => {
    const anchor = validator(0, 0);
    pubkeyCache.append(0, anchor.pubkey);

    promoteFinalizedPubkeys(pubkeyCache, view([]), 1);

    expect(pubkeyCache.size).toBe(1);
    expect(pubkeyCache.getPubkeyBytes(0)).toEqual(anchor.pubkey);
  });
});
