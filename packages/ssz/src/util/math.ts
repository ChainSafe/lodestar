/** @ignore */
export function bitLength (n: number): number {
  let length = 0;
  while (n !== 0) {
    // rshift only works to 32 bits, so we int div by 2 instead
    n = Math.floor(n / 2);
    length++;
  }
  return length;
}

/** @ignore */
export function nextPowerOf2 (n: number): number {
  return n <= 0 ? 1 : Math.pow(2, bitLength(n - 1));
}

/** @ignore */
export function previousPowerOf2 (n: number): number {
  return n === 0 ? 1 : Math.pow(2, bitLength(n) - 1);
}
