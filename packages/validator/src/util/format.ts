export function isValidatePubkeyHex(pubkeyHex: string): boolean {
  return /^0x[0-9a-fA-F]{96}$/.test(pubkeyHex);
}

export function formatBigDecimal(numerator: bigint, denominator: bigint, maxDecimalFactor: bigint): string {
  const full = numerator / denominator;
  const fraction = ((numerator - full * denominator) * maxDecimalFactor) / denominator;
  return `${full}.${fraction}`;
}
