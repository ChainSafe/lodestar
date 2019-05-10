/**
 * @module util/address
 */

export function isValidAddress(address: string) {
  return !!address && address.startsWith('0x') && address.length === 42;

}
