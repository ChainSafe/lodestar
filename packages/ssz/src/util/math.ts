/** @ignore */
export function bitLength (n: number): number {
  return n.toString(2).length;
}

/** @ignore */
export function nextPowerOf2 (n: number): number {
  return n <= 0 ? 1 : Math.pow(2, bitLength(n - 1));
}

/** @ignore */
export function previousPowerOf2 (n: number): number {
  return n === 0 ? 1 : Math.pow(2, bitLength(n) - 1);
}
