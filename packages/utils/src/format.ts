import {toRootHex} from "#bytes";
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
 * Format wei as ETH, with up to 5 decimals
 */
export function formatWeiToEth(wei: bigint): string {
  return formatBigDecimal(wei, ETH_TO_WEI, MAX_DECIMAL_FACTOR);
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

export function groupSequentialIndices(indices: number[]): string[] {
  if (indices.length === 0) {
    return [];
  }

  // Get unique values and sort them
  const uniqueValues = Array.from(new Set(indices)).sort((a, b) => a - b);

  const result: string[] = [];
  let start = uniqueValues[0];
  let end = uniqueValues[0];

  for (let i = 1; i < uniqueValues.length; i++) {
    const current = uniqueValues[i];

    if (current === end + 1) {
      end = current; // extend the range
    } else {
      result.push(start === end ? `${start}` : `${start}-${end}`);
      start = current;
      end = current;
    }
  }

  // Push the last range
  result.push(start === end ? `${start}` : `${start}-${end}`);

  return result;
}

/**
 * Pretty print indices from an array of numbers.
 *
 * example:
 * ```ts
 * const indices = [1, 3, 109, 110, 111, 112, 113, 127];
 * console.log(prettyPrintIndices(indices));
 * // `1,3,110-113,127`
 * ```
 */
export function prettyPrintIndices(indices: number[]): string {
  const increments = groupSequentialIndices(indices);
  return `[${increments.join(", ")}]`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 0) {
    throw new Error("bytes must be a positive number, got " + bytes);
  }

  if (bytes === 0) {
    return "0 Bytes";
  }

  // size of a kb
  const k = 1024;

  // only support up to GB
  const units = ["Bytes", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
  const formattedSize = (bytes / Math.pow(k, i)).toFixed(2);

  return `${formattedSize} ${units[i]}`;
}
