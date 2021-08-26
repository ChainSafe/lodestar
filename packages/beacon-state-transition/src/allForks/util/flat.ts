import {phase0} from "@chainsafe/lodestar-types";

export type ValidatorFlat = Pick<
  phase0.Validator,
  "activationEligibilityEpoch" | "activationEpoch" | "effectiveBalance" | "exitEpoch" | "slashed" | "withdrawableEpoch"
>;

// A "flat" validator is a concrete `Validator`
// For intermediate computation, the TreeBacked representation slows things down, so a regular object is used instead.
export function createValidatorFlat(v: phase0.Validator | ValidatorFlat): ValidatorFlat {
  return {
    effectiveBalance: v.effectiveBalance,
    slashed: v.slashed,
    activationEligibilityEpoch: v.activationEligibilityEpoch,
    activationEpoch: v.activationEpoch,
    exitEpoch: v.exitEpoch,
    withdrawableEpoch: v.withdrawableEpoch,
  };
}
