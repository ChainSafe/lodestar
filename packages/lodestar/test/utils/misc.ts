
/**
 * Renerates a random integer between min (included) and max (excluded).
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

export type DeepPartial<T> = T extends Function ? T : (T extends object ? { [P in keyof T]?: DeepPartial<T[P]>; } : T);
