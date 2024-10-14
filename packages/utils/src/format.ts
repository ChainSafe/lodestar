import {toRootHex} from "./bytes/index.js";
import {ETH_TO_WEI} from "./ethConversion.js";

/**
 * Format bytes as `0x1234…1234`
 * 4 bytes can represent 4294967296 values, so the chance of collision is low
 */
export function prettyBytes(root: Uint8Array | string): string {
  const str = typeof root === "string" ? root : toRootHex(root);
  return `${str.slice(0, 6)}…${str.slice(-4)}`;
}

/**
 * Format bytes as `0x1234…`
 * Paired with block numbers or slots, it can still act as a decent identify-able format
 */
export function prettyBytesShort(root: Uint8Array | string): string {
  const str = typeof root === "string" ? root : toRootHex(root);
  return `${str.slice(0, 6)}…`;
}

/**
 * Truncate and format bytes as `0x123456789abc`
 * 6 bytes is sufficient to avoid collisions and it allows to easily look up
 * values on explorers like beaconcha.in while improving readability of logs
 */
export function truncBytes(root: Uint8Array | string): string {
  const str = typeof root === "string" ? root : toRootHex(root);
  return str.slice(0, 14);
}

/**
 * Format a bigint value as a decimal string
 */
export function formatBigDecimal(numerator: bigint, denominator: bigint, maxDecimalFactor: bigint): string {
  const full = numerator / denominator;
  const fraction = ((numerator - full * denominator) * maxDecimalFactor) / denominator;

  // zeros to be added post decimal are number of zeros in maxDecimalFactor - number of digits in fraction
  const zerosPostDecimal = String(maxDecimalFactor).length - 1 - String(fraction).length;
  return `${full}.${"0".repeat(zerosPostDecimal)}${fraction}`;
}

// display upto 5 decimal places
const MAX_DECIMAL_FACTOR = BigInt("100000");

/**
 * Format wei as ETH, with up to 5 decimals and append ' ETH'
 */
export function prettyWeiToEth(wei: bigint): string {
  return `${formatBigDecimal(wei, ETH_TO_WEI, MAX_DECIMAL_FACTOR)} ETH`;
}

/**
 * Format milliseconds to time format HH:MM:SS.ms
 */
export function prettyMsToTime(timeMs: number): string {
  const date = new Date(0, 0, 0, 0, 0, 0, timeMs);
  return `${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}.${date.getMilliseconds()}`;
}
