/**
 * @module util/math
 */


/**
 * Return the min number between two big numbers.
 */
export function bnMin(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/**
 * Return the max number between two big numbers.
 */
export function bnMax(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

export function intDiv(dividend: number, divisor: number): number {
  return Math.floor(dividend / divisor);
}

/**
 * Calculate the largest integer k such that k**2 <= n.
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

export function bnSqrt(n: bigint): bigint {
  let x = n;
  let y = (x + 1n)/ 2n;
  while (y < x) {
    x = y;
    y = (x + n / x)/ 2n;
  }
  return x;
}
