/**
 * @module util/addressbool
 */
import {bool} from "../types";

export function isValidAddress(address: string): bool {
  return !!address && address.startsWith('0x') && address.length === 42;

}
