export function isValidatePubkeyHex(pubkeyHex: string): boolean {
  return /^0x[0-9a-fA-F]{96}$/.test(pubkeyHex);
}

export function formatBigDecimal(numerator: bigint, denominator: bigint, maxDecimalFactor: bigint): string {
  const full = numerator / denominator;
  const fraction = ((numerator - full * denominator) * maxDecimalFactor) / denominator;

  // zeros to be added post decimal are number of zeros in maxDecimalFactor - number of digits in fraction
  const zerosPostDecimal = String(maxDecimalFactor).length - 1 - String(fraction).length;
  return `${full}.${"0".repeat(zerosPostDecimal)}${fraction}`;
}
