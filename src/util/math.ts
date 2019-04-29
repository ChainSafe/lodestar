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

export function intDiv(dividend: number, divisor: number): number {
  return Math.floor(dividend / divisor);
}

/**
 * Calculate the largest integer k such that k**2 <= n.
 * Used in reward/penalty calculations
 * @param {number} n
 * @returns {number}
 */
export function intSqrt(n: number): number {
  let x = n;
  let y = intDiv(x + 1, 2);
  while (y < x) {
    x = y;
    y = intDiv(x + intDiv(n, x), 2);
  }
  return x;
}

export function bnSqrt(n: BN): BN {
  let x = n.clone();
  let y = x.addn(1).divn(2);
  while (y.lt(x)) {
    x = y;
    y = x.add(n.div(x)).divn(2);
  }
  return x;
}
