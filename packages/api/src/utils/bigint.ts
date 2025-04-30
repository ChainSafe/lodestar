/**
 * Safely converts a bigint to a number, throwing an error if the value is outside the safe integer range
 * or if the conversion would result in NaN.
 */
export function bigintToNumber(bn: bigint): number {
  if (bn > BigInt(Number.MAX_SAFE_INTEGER) || bn < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error(`Cannot safely convert bigint ${bn} to number - value outside safe integer range`);
  }
  const num = Number(bn);
  if (Number.isNaN(num)) {
    throw new Error(`Cannot convert bigint ${bn} to number - conversion resulted in NaN`);
  }
  return num;
}
