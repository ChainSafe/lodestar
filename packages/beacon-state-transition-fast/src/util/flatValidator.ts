import {readOnlyEntries} from "@chainsafe/ssz";
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

/**
 * Convert a Validator (most likely with a tree-backing)
 * into a IFlatValidator
 */
export function createIFlatValidator(v: Validator): IFlatValidator {
  return (readOnlyEntries(v).reduce((flat, [k, v]) => {
    flat[k] = v;
    return flat;
  }, {} as Record<string, Validator[keyof Validator]>) as unknown) as IFlatValidator;
}

export function isActiveIFlatValidator(v: IFlatValidator, epoch: Epoch): boolean {
  return v.activationEpoch <= epoch && epoch < v.exitEpoch;
}
