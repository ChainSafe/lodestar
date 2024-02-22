export function isValidatePubkeyHex(pubkeyHex: string): boolean {
  return /^0x[0-9a-fA-F]{96}$/.test(pubkeyHex);
}
