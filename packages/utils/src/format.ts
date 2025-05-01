import {bigintToNumber} from "./bigint.js";
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
 * Format wei as ETH, with up to 5 decimals
 */
export function formatWeiToEth(wei: bigint): number {
  return bigintToNumber(wei / ETH_TO_WEI);
}

/**
 * Format wei as ETH, with up to 5 decimals and append ' ETH'
 */
export function prettyWeiToEth(wei: bigint): string {
  return `${formatWeiToEth(wei)} ETH`;
}

/**
 * Format milliseconds to time format HH:MM:SS.ms
 */
export function prettyMsToTime(timeMs: number): string {
  const date = new Date(0, 0, 0, 0, 0, 0, timeMs);
  return `${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}.${date.getMilliseconds()}`;
}

/**
 * Remove 0x prefix from a string
 */
export function strip0xPrefix(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

/**
 * Format a decimal number represented by a fraction (numerator/denominator) with a specific decimal factor.
 * Example: formatBigDecimal(103797739275696858n, 1000000000000000000n, 100000n) => "0.10379"
 */
export function formatBigDecimal(numerator: bigint, denominator: bigint, decimalFactor: bigint): string {
  const quotient = (numerator * decimalFactor) / denominator;
  const integerPart = quotient / decimalFactor;
  const decimalPart = quotient % decimalFactor;

  // Convert decimal part to string and pad with leading zeros
  let decimalStr = decimalPart.toString();
  const targetLength = decimalFactor.toString().length - 1;
  decimalStr = decimalStr.padStart(targetLength, "0");

  // Remove trailing zeros
  decimalStr = decimalStr.replace(/0+$/, "");

  return `${integerPart}${decimalStr ? "." + decimalStr : ""}`;
}
