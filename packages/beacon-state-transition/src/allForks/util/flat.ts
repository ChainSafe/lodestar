import {phase0, BLSPubkey, Bytes32} from "@chainsafe/lodestar-types";

// A "flat" validator is a concrete `Validator`
// For intermediate computation, the TreeBacked representation slows things down, so a regular object is used instead.
export function createValidatorFlat(v: phase0.Validator): phase0.Validator {
  return {
    pubkey: v.pubkey.valueOf() as BLSPubkey,
    withdrawalCredentials: v.withdrawalCredentials.valueOf() as Bytes32,
    effectiveBalance: v.effectiveBalance,
    slashed: v.slashed,
    activationEligibilityEpoch: v.activationEligibilityEpoch,
    activationEpoch: v.activationEpoch,
    exitEpoch: v.exitEpoch,
    withdrawableEpoch: v.withdrawableEpoch,
  };
}
