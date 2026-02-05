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
 * Get client info strings for adaptive sizing.
 * Returns an array of candidate strings ordered from most complete to most compact.
 */
function getClientInfoCandidates(cl: ClientVersion, el: ClientVersion | null | undefined): string[] {
  if (el != null) {
    const {code: elCode, commit: elCommit} = el;
    const {code: clCode, commit: clCommit} = cl;
    return [
      // Full: "EL1234LS5678" (12 bytes)
      `${elCode}${elCommit.slice(0, 4)}${clCode}${clCommit.slice(0, 4)}`,
      // Compact: "EL12LS56" (8 bytes)
      `${elCode}${elCommit.slice(0, 2)}${clCode}${clCommit.slice(0, 2)}`,
      // Codes only: "ELLS" (4 bytes)
      `${elCode}${clCode}`,
      // Single code: "EL" (2 bytes) - EL code when available (matches Teku)
      elCode,
    ];
  }
  const {code: clCode, commit: clCommit} = cl;
  return [
    // CL only full: "LS5678" (6 bytes)
    `${clCode}${clCommit.slice(0, 4)}`,
    // CL only compact: "LS56" (4 bytes)
    `${clCode}${clCommit.slice(0, 2)}`,
    // CL code only: "LS" (2 bytes)
    clCode,
  ];
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
 * Appends client version info to user graffiti using adaptive sizing.
 * Tries to fit as much client info as possible within the 32-byte graffiti limit.
 *
 * Format: "{userGraffiti} {clientInfo}" where clientInfo adapts based on available space:
 * - Full: "EL1234LS5678" - EL code + 4 hex commit + CL code + 4 hex commit
 * - Compact: "EL12LS56" - EL code + 2 hex commit + CL code + 2 hex commit
 * - Codes only: "ELLS" - Just client codes
 *
 * If no space remains for even the shortest tier, returns user graffiti (possibly truncated).
 * If private mode is enabled, returns user graffiti without appending client info.
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

  // First, truncate user graffiti to fit within limit (UTF-8 safe)
  const truncatedGraffiti = truncateUtf8ToBytes(userGraffiti, GRAFFITI_SIZE);
  const userBytes = Buffer.byteLength(truncatedGraffiti, "utf8");

  // If truncated graffiti fills the entire space, return it
  if (userBytes >= GRAFFITI_SIZE) {
    return truncatedGraffiti;
  }

  const candidates = getClientInfoCandidates(consensusClientVersion, executionClientVersion);
  const hasUserGraffiti = userBytes > 0;
  const availableBytesWithSeparator = hasUserGraffiti ? GRAFFITI_SIZE - userBytes - 1 : GRAFFITI_SIZE - userBytes;
  const availableBytesWithoutSeparator = GRAFFITI_SIZE - userBytes;

  // Teku special case: if exactly 3 bytes remain after reserving space for separator,
  // drop the separator and use "codes-only" tier without separator
  // This allows 28-byte graffiti + "BULS" (4 bytes) = 32 bytes
  // See: GraffitiBuilder.java buildGraffiti() AUTO case
  if (hasUserGraffiti && availableBytesWithSeparator === 3) {
    // Get codes-only tier (index 2: "ELLS" for EL+CL or "LS" for CL-only)
    const codesOnlyTier = candidates[2];
    if (codesOnlyTier !== undefined) {
      const codesOnlyBytes = Buffer.byteLength(codesOnlyTier, "utf8");
      if (codesOnlyBytes <= availableBytesWithoutSeparator) {
        return `${truncatedGraffiti}${codesOnlyTier}`;
      }
    }
  }

  // Normal case: find the best candidate that fits with separator
  for (const clientInfo of candidates) {
    const clientInfoBytes = Buffer.byteLength(clientInfo, "utf8");
    if (clientInfoBytes <= availableBytesWithSeparator) {
      return hasUserGraffiti ? `${truncatedGraffiti} ${clientInfo}` : clientInfo;
    }
  }

  // Fallback: if nothing fits with separator, try without separator
  // This handles cases like 30-byte graffiti where only 2 bytes remain
  if (hasUserGraffiti) {
    for (const clientInfo of candidates) {
      const clientInfoBytes = Buffer.byteLength(clientInfo, "utf8");
      if (clientInfoBytes <= availableBytesWithoutSeparator) {
        return `${truncatedGraffiti}${clientInfo}`;
      }
    }
  }

  // No candidate fits, return truncated user graffiti unchanged
  return truncatedGraffiti;
}
