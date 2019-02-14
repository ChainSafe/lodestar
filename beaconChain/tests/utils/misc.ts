import BN = require("bn.js");

/**
 * Renerates a random integer between min (included) and max (excluded).
 */
export function randBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min)) + min;
}

/**
 * Wraps randBetween and returns a bigNumber.
 * @returns {BN}
 */
export function randBetweenBN(min: number, max: number): BN {
  return new BN(randBetween(min, max));
}
