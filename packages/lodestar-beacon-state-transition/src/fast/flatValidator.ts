import {Gwei, Epoch, Validator} from "@chainsafe/lodestar-types";

/**
 * Concrete Validator w/o pubkey & withdrawCredentials
 */
export interface IFlatValidator {
  effectiveBalance: Gwei;
  slashed: boolean;
  activationEligibilityEpoch: Epoch;
  activationEpoch: Epoch;
  exitEpoch: Epoch;
  withdrawableEpoch: Epoch;
}

export function createIFlatValidator(v: Validator): IFlatValidator {
  return {
    effectiveBalance: v.effectiveBalance,
    slashed: v.slashed,
    activationEligibilityEpoch: v.activationEligibilityEpoch,
    activationEpoch: v.activationEpoch,
    exitEpoch: v.exitEpoch,
    withdrawableEpoch: v.withdrawableEpoch,
  };
}
