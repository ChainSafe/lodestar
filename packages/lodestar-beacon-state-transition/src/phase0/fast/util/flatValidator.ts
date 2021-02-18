import {readOnlyEntries} from "@chainsafe/ssz";
import {Gwei, Epoch, phase0} from "@chainsafe/lodestar-types";

/**
 * Concrete Validator w/o pubkey & withdrawCredentials.
 * For intermediate computation the remerkleable representation slows things down, so a regular object
 * is used instead.
 */
export interface IFlatValidator {
  effectiveBalance: Gwei;
  slashed: boolean;
  activationEligibilityEpoch: Epoch;
  activationEpoch: Epoch;
  exitEpoch: Epoch;
  withdrawableEpoch: Epoch;
}

/**
 * Convert a Validator (most likely with a tree-backing)
 * into a IFlatValidator
 */
export function createIFlatValidator(v: phase0.Validator): IFlatValidator {
  return (readOnlyEntries(v).reduce((flat, [k, v]) => {
    flat[k] = v;
    return flat;
  }, {} as Record<string, phase0.Validator[keyof phase0.Validator]>) as unknown) as IFlatValidator;
}

export function isActiveIFlatValidator(v: IFlatValidator, epoch: Epoch): boolean {
  return v.activationEpoch <= epoch && epoch < v.exitEpoch;
}
