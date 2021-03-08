/**
 * @module util/math
 */

import {assert} from "./assert";

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
  let y = (x + BigInt(1)) / BigInt(2);
  while (y < x) {
    x = y;
    y = (x + n / x) / BigInt(2);
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

/**
 * Add 2 arrays starting from an index
 * @param array
 * @param delta
 * @param offset
 */
export function addUint8Array(array: Uint8Array, delta: Uint8Array, offset: number): Uint8Array {
  assert.gte(array.length, delta.length, "invalid array lengths");
  const result = new Uint8Array(array.length);
  const arrayLength = array.length;
  const deltaLength = delta.length;
  let remainder = 0;
  for (let index = 0; index < arrayLength; index++) {
    const isInDelta = index >= offset && index < offset + deltaLength;
    const deltaItem = isInDelta ? delta[index - offset] : 0;
    const total = array[index] + deltaItem + remainder;
    result[index] = total & 0xff;
    remainder = isInDelta ? total >> 8 : 0;
  }
  return result;
}

/**
 * Subject 2 array (array - delta)
 * @param array
 * @param delta
 */
export function subtractUint8ArrayGte0(array: Uint8Array, delta: Uint8Array, offset: number): Uint8Array {
  assert.gte(array.length, delta.length, "The array length to subtract should be gte delta's");
  const result = new Uint8Array(array.length);
  const arrayLength = array.length;
  const deltaLength = delta.length;
  let remainder = 0;
  for (let index = 0; index < arrayLength; index++) {
    const isInDelta = index >= offset && index < offset + deltaLength;
    const subtract = isInDelta ? array[index] - delta[index - offset] - remainder + 256 : array[index];
    result[index] = subtract & 0xff;
    if (isInDelta) {
      remainder = subtract < 256 ? 1 : 0;
    }
  }
  if (remainder > 0) {
    for (let index = offset; index < deltaLength + offset; index++) {
      result[index] = 0;
    }
  }
  return result;
}

/**
 * Add/subject multiple bigint under the same Uint8Array
 * @param array
 * @param deltas
 */
export function calculateBigIntUint8Array(array: Uint8Array, deltas: number[]): Uint8Array {
  const bigIntLength = 8;
  assert.equal(array.length / 8, deltas.length, "number of delta is not correct");
  const result = new Uint8Array(array.length);
  result.set(array);
  for (let i = 0; i < deltas.length; i++) {
    const delta = deltas[i];
    if (delta > 0) {
      increaseUint8Array(result, delta, i * bigIntLength, bigIntLength);
    } else if (delta < 0) {
      decreaseUint8ArrayGte0(result, -1 * delta, i * bigIntLength, bigIntLength);
    }
  }
  return result;
}

export function increaseUint8Array(array: Uint8Array, delta: number, offset: number, length = 8): void {
  assert.gte(delta, 0, "increaseUint8Array delta should be >= 0");
  let remainder = delta;
  for (let index = offset; index < length + offset; index++) {
    if (remainder === 0) {
      return;
    } else {
      const total = array[index] + remainder;
      array[index] = total & 0xff;
      remainder = Math.floor(total / 256); // bitshift only works with 32 bits
    }
  }
}

/**
 * Decrease an array to delta, make sure the result is >= 0
 */
export function decreaseUint8ArrayGte0(array: Uint8Array, delta: number, offset: number, length = 8): void {
  assert.gte(delta, 0, "decreaseUint8Array delta should be >= 0");
  // remainder is >= 0
  let remainder = delta;
  for (let index = offset; index < length + offset; index++) {
    if (remainder === 0) {
      return;
    } else {
      const subtract = array[index] - remainder;
      array[index] = subtract & 0xff;
      remainder = subtract >= 0 ? 0 : Math.ceil((-1 * subtract) / 256);
    }
  }
  if (remainder > 0) {
    for (let index = offset; index < length + offset; index++) {
      array[index] = 0;
    }
  }
}

/**
 * If a > b, return 1, else if a < b, return -1, else return 0
 * @param a an Uint8Array
 * @param b an Uint8Array
 */
export function compareUint8Array(a: Uint8Array, b: Uint8Array): number {
  if (a.length > b.length) {
    const deltaLength = a.length - b.length;
    for (let i = deltaLength; i < a.length; i++) {
      if (a[i] > 0) return 1;
    }
    return compareUint8ArraySameLength(a.subarray(0, b.length), b);
  } else if (a.length < b.length) {
    const deltaLength = b.length - a.length;
    for (let i = deltaLength; i < b.length; i++) {
      if (b[i] > 0) return -1;
    }
    return compareUint8ArraySameLength(a, b.subarray(0, a.length));
  } else {
    return compareUint8ArraySameLength(a, b);
  }
}

function compareUint8ArraySameLength(a: Uint8Array, b: Uint8Array): number {
  assert.equal(a.length, b.length, "arrays to compare should have same length");
  for (let i = a.length - 1; i >= 0; i--) {
    if (a[i] > b[i]) {
      return 1;
    } else if (a[i] < b[i]) {
      return -1;
    }
  }
  // end for
  return 0;
}
