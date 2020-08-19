/**
 * @module util/address
 */

export function isValidAddress(address: string): boolean {
  return !!address && address.startsWith("0x") && address.length === 42;
}
