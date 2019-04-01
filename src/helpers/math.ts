import BN from "bn.js";

/**
 * Return the min number between two big numbers.
 * @param {BN} a
 * @param {BN} b
 * @returns {BN}
 */
export function bnMin(a: BN, b: BN): BN {
  return a.lt(b) ? a : b;
}

/**
 * Return the max number between two big numbers.
 * @param {BN} a
 * @param {BN} b
 * @returns {BN}
 */
export function bnMax(a: BN, b: BN): BN {
  return a.gt(b) ? a : b;
}
