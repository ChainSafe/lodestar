import {GRAFFITI_SIZE} from "../constants/index.js";
import {ClientVersion} from "../execution/index.js";

/**
 * Parses a graffiti UTF8 string and returns a 32 bytes buffer right padded with zeros
 */
export function toGraffitiBuffer(graffiti: string): Buffer {
  return Buffer.concat([Buffer.from(graffiti, "utf8"), Buffer.alloc(GRAFFITI_SIZE, 0)], GRAFFITI_SIZE);
}

export function getDefaultGraffiti(
  opts: {private?: boolean},
  consensusClientVersion?: ClientVersion,
  executionClientVersion?: ClientVersion
): string {
  if (opts.private) {
    return "";
  }

  if (consensusClientVersion === undefined) {
    throw new Error("Consensus client version must be provided if opts.private is set to false");
  }

  if (executionClientVersion !== undefined) {
    const {code: executionCode, commit: executionCommit} = executionClientVersion;

    // Follow the 2-byte commit format in https://github.com/ethereum/execution-apis/pull/517#issuecomment-1918512560
    return `${executionCode}${executionCommit.slice(0, 4)}${consensusClientVersion.code}${consensusClientVersion.commit.slice(0, 4)}`;
  }

  // No EL client info available. We still want to include CL info albeit not spec compliant
  return `${consensusClientVersion.code}${consensusClientVersion.commit.slice(0, 4)}`;
}
