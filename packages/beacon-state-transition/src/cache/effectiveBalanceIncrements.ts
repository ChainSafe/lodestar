import {EFFECTIVE_BALANCE_INCREMENT} from "@chainsafe/lodestar-params";
import {BeaconStateAllForks} from "../types.js";

/**
 * Alias to allow easier refactoring.
 * TODO: Estimate the risk of future proof of MAX_EFFECTIVE_BALANCE_INCREMENT < 255
 */
export type EffectiveBalanceIncrements = Uint8Array;

/** Helper to prevent re-writting tests downstream if we change Uint8Array to number[] */
export function getEffectiveBalanceIncrementsZeroed(len: number): EffectiveBalanceIncrements {
  return new Uint8Array(len);
}

/**
 * effectiveBalanceIncrements length will always be equal or greater than validatorCount. The
 * getEffectiveBalanceIncrementsByteLen() modulo is used to reduce the frequency at which its Uint8Array is recreated.
 * if effectiveBalanceIncrements has length greater than validatorCount it's not a problem since those values would
 * never be accessed.
 */
export function getEffectiveBalanceIncrementsWithLen(validatorCount: number): EffectiveBalanceIncrements {
  // TODO: Research what's the best number to minimize both memory cost and copy costs
  const byteLen = 1024 * Math.ceil(validatorCount / 1024);

  return new Uint8Array(byteLen);
}

/**
 * Shows how EffectiveBalanceIncrements is meant to be populated.
 * In practice this function should not be used, since it more efficient to loop the validators array once and do
 * more tasks than only populating effectiveBalanceIncrements
 */
export function getEffectiveBalanceIncrements(state: BeaconStateAllForks): EffectiveBalanceIncrements {
  const validatorsArr = state.validators.getAllReadonlyValues();
  const effectiveBalanceIncrements = new Uint8Array(validatorsArr.length);
  for (let i = 0; i < validatorsArr.length; i++) {
    effectiveBalanceIncrements[i] = Math.floor(validatorsArr[i].effectiveBalance / EFFECTIVE_BALANCE_INCREMENT);
  }
  return effectiveBalanceIncrements;
}
