import {keccak256} from "ethereum-cryptography/keccak.js";
import {fromHex, toHexString} from "./bytes.js";

/**
 * Format bytes as `0x1234…1234`
 * 4 bytes can represent 4294967296 values, so the chance of collision is low
 */
export function prettyBytes(root: Uint8Array | string): string {
  const str = typeof root === "string" ? root : toHexString(root);
  return `${str.slice(0, 6)}…${str.slice(-4)}`;
}

/**
 * Format bytes as `0x1234…`
 * Paired with block numbers or slots, it can still act as a decent identify-able format
 */
export function prettyBytesShort(root: Uint8Array | string): string {
  const str = typeof root === "string" ? root : toHexString(root);
  return `${str.slice(0, 6)}…`;
}

/**
 * Truncate and format bytes as `0x123456789abc`
 * 6 bytes is sufficient to avoid collisions and it allows to easily look up
 * values on explorers like beaconcha.in while improving readability of logs
 */
export function truncBytes(root: Uint8Array | string): string {
  const str = typeof root === "string" ? root : toHexString(root);
  return str.slice(0, 14);
}

/**
 * Formats an address according to [ERC55](https://eips.ethereum.org/EIPS/eip-55)
 *
 * @param address an hex address
 * @returns an ERC55 formatted version of `address`
 */
export function toChecksumAddress(address: string): string {
  const rawAddress = address.toLowerCase().startsWith("0x") ? address.slice(2) : address;
  const bytes = fromHex(rawAddress);
  const hash = toHexString(keccak256(bytes)).slice(2);
  let checksumAddress = "0x";
  for (let i = 0; i < rawAddress.length; i++) {
    if (parseInt(hash[i], 16) >= 8) {
      checksumAddress += rawAddress[i].toUpperCase();
    } else {
      checksumAddress += rawAddress[i];
    }
  }
  return checksumAddress;
}
