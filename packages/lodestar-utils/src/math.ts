/**
 * @module util/math
 */


/**
 * Return the min number between two big numbers.
 */
export function bigIntMin(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/**
 * Return the max number between two big numbers.
 */
export function bigIntMax(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

/**
 * Return the min number between many big numbers.
 */
export function bigIntArrayMin(...bigints: bigint[]): bigint {
  return bigints.reduce(bigIntMin, bigints[0]);
}

/**
 * Return the max number between many big numbers.
 */
export function bigIntArrayMax(...bigints: bigint[]): bigint {
  return bigints.reduce(bigIntMax, bigints[0]);
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

export function bigIntSqrt(n: bigint): bigint {
  let x = n;
  let y = (x + 1n)/ 2n;
  while (y < x) {
    x = y;
    y = (x + n / x)/ 2n;
  }
  return x;
}

/**
 * Regenerates a random integer between min (included) and max (excluded).
 */
export function randBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min)) + min;
}

/**
 * Wraps randBetween and returns a bigNumber.
 * @returns {bigint}
 */
export function randBetweenBigInt(min: number, max: number): bigint {
  return BigInt(randBetween(min, max));
}