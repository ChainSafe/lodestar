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

function appendLongestFittingSuffix(userGraffiti: string, suffixes: string[]): string {
  const userGraffitiBytes = Buffer.byteLength(userGraffiti, "utf8");
  if (userGraffitiBytes >= GRAFFITI_SIZE) {
    return userGraffiti;
  }

  const availableBytes = GRAFFITI_SIZE - userGraffitiBytes;

  for (const suffix of suffixes) {
    if (Buffer.byteLength(suffix, "utf8") <= availableBytes) {
      return `${userGraffiti}${suffix}`;
    }
  }

  return userGraffiti;
}

/**
 * Appends the richest available client watermark that fits after user graffiti.
 *
 * Tiers are:
 * - full EL/CL watermark, e.g. " BU9b0eLS80c2"
 * - EL/CL client codes, e.g. " BULS"
 * - CL client code, e.g. " LS"
 */
export function appendClientInfoToGraffiti(
  userGraffiti: string,
  consensusClientVersion: ClientVersion,
  executionClientVersion: ClientVersion | null | undefined,
  opts: {private?: boolean} = {}
): string {
  if (opts.private) {
    return userGraffiti;
  }

  // Graffiti supplied via the beacon API is decoded from a fixed 32-byte field (see
  // fromGraffitiHex) and arrives right-padded with NUL bytes. Trim only trailing padding
  // NULs; a NUL that appears in the middle of the string is data, not padding.
  let end = userGraffiti.length;
  while (end > 0 && userGraffiti.charCodeAt(end - 1) === 0) {
    end--;
  }
  const graffiti = userGraffiti.slice(0, end);

  const fullClientInfo = getDefaultGraffiti(consensusClientVersion, executionClientVersion, {private: false});
  if (graffiti.length === 0) {
    return fullClientInfo;
  }

  const suffixes =
    executionClientVersion != null
      ? [
          ` ${fullClientInfo}`,
          ` ${executionClientVersion.code}${consensusClientVersion.code}`,
          ` ${consensusClientVersion.code}`,
        ]
      : [` ${fullClientInfo}`, ` ${consensusClientVersion.code}`];

  return appendLongestFittingSuffix(graffiti, suffixes);
}

export function getBlockGraffiti(
  userGraffiti: string | undefined,
  consensusClientVersion: ClientVersion,
  executionClientVersion: ClientVersion | null | undefined,
  opts: {private?: boolean; graffitiAppend?: boolean}
): string {
  if (userGraffiti === undefined) {
    return getDefaultGraffiti(consensusClientVersion, executionClientVersion, opts);
  }

  if (opts.graffitiAppend === false) {
    return userGraffiti;
  }

  return appendClientInfoToGraffiti(userGraffiti, consensusClientVersion, executionClientVersion, opts);
}
