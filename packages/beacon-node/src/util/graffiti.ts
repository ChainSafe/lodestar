import {Bytes32} from "@lodestar/types";
import {GRAFFITI_SIZE} from "../constants/index.js";
import {ClientVersion} from "../execution/index.js";

/**
 * Parses a graffiti UTF8 string and returns a 32 bytes buffer right padded with zeros
 */
export function toGraffitiBytes(graffiti: string): Bytes32 {
  return Buffer.concat([Buffer.from(graffiti, "utf8"), Buffer.alloc(GRAFFITI_SIZE, 0)], GRAFFITI_SIZE);
}

/**
 * Converts a graffiti from 32 bytes buffer back to a UTF-8 string
 */
export function fromGraffitiBytes(graffiti: Bytes32): string {
  return Buffer.from(graffiti.buffer, graffiti.byteOffset, graffiti.byteLength)
    .toString("utf8")
    .replaceAll("\u0000", "");
}

export function getDefaultGraffiti(
  consensusClientVersion: ClientVersion,
  executionClientVersion: ClientVersion | null | undefined,
  opts: {private?: boolean}
): string {
  if (opts.private) {
    return "";
  }

  if (executionClientVersion != null) {
    const {code: executionCode, commit: executionCommit} = executionClientVersion;

    // Follow the 2-byte commit format in https://github.com/ethereum/execution-apis/pull/517#issuecomment-1918512560
    return `${executionCode}${executionCommit.slice(0, 4)}${consensusClientVersion.code}${consensusClientVersion.commit.slice(0, 4)}`;
  }

  // No EL client info available. We still want to include CL info albeit not spec compliant
  return `${consensusClientVersion.code}${consensusClientVersion.commit.slice(0, 4)}`;
}

/**
 * Truncates a UTF-8 string to fit within maxBytes without splitting multi-byte characters.
 * Returns the truncated string.
 */
export function truncateUtf8ToBytes(str: string, maxBytes: number): string {
  const buf = Buffer.from(str, "utf8");
  if (buf.length <= maxBytes) {
    return str;
  }

  // Find the last valid UTF-8 boundary within maxBytes
  let truncatedLength = maxBytes;
  // Move back if we're in the middle of a multi-byte sequence
  while (truncatedLength > 0 && (buf[truncatedLength] & 0xc0) === 0x80) {
    truncatedLength--;
  }

  return buf.slice(0, truncatedLength).toString("utf8");
}

/**
 * Appends client version info to user graffiti.
 *
 * Format: "{userGraffiti} {clientInfo}" where clientInfo is the full client watermark.
 * If the combined result exceeds 32 bytes, it is truncated.
 *
 * For full client info to be included, keep custom graffiti under 19 bytes (with EL)
 * or 25 bytes (CL-only).
 *
 * @param userGraffiti - User-provided graffiti string
 * @param consensusClientVersion - CL client version info
 * @param executionClientVersion - EL client version info (optional)
 * @param opts - Options including private mode
 * @returns Combined graffiti string (always <= 32 bytes)
 */
export function appendClientInfoToGraffiti(
  userGraffiti: string,
  consensusClientVersion: ClientVersion,
  executionClientVersion: ClientVersion | null | undefined,
  opts: {private?: boolean} = {}
): string {
  // Respect private mode - never leak client info
  if (opts.private) {
    return truncateUtf8ToBytes(userGraffiti, GRAFFITI_SIZE);
  }

  // Get full client info watermark
  const clientInfo = getDefaultGraffiti(consensusClientVersion, executionClientVersion, {private: false});

  // If no user graffiti, just return client info
  if (userGraffiti.length === 0) {
    return clientInfo;
  }

  // Append with separator and truncate to fit 32 bytes
  const combined = `${userGraffiti} ${clientInfo}`;
  return truncateUtf8ToBytes(combined, GRAFFITI_SIZE);
}
