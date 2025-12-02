/**
 * Computes the worst-case compression result by SSZ-Snappy
 */
export function maxEncodedLen(sszLength: number): number {
  // worst-case compression result by Snappy
  return 32 + sszLength + sszLength / 6;
}
