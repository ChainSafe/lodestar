import {BLSPubkey, Bytes32, Validator} from "@chainsafe/lodestar-types/phase0";

// A "flat" validator is a concrete `Validator`
// For intermediate computation, the TreeBacked representation slows things down, so a regular object is used instead.
export function createValidatorFlat(v: Validator): Validator {
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
