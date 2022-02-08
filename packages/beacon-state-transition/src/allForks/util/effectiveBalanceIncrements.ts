/**
 * Alias to allow easier refactoring.
 * TODO: Estimate the risk of future proof of MAX_EFFECTIVE_BALANCE_INCREMENT < 255
 */
export type EffectiveBalanceIncrements = Uint8Array;

/** Helper to prevent re-writting tests downstream if we change Uint8Array to number[] */
export function getEffectiveBalanceIncrementsZeroed(len: number): EffectiveBalanceIncrements {
  return new Uint8Array(len);
}
