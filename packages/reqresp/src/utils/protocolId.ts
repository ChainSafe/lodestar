import {Encoding, ProtocolAttributes} from "../types.js";

/**
 * https://github.com/ethereum/consensus-specs/blob/v1.2.0/specs/phase0/p2p-interface.md#protocol-identification
 */
export function formatProtocolID(protocolPrefix: string, method: string, version: number, encoding: Encoding): string {
  return `${protocolPrefix}/${method}/${version}/${encoding}`;
}

/**
 * https://github.com/ethereum/consensus-specs/blob/v1.2.0/specs/phase0/p2p-interface.md#protocol-identification
 */
export function parseProtocolID(protocolId: string): ProtocolAttributes {
  const result = protocolId.split("/");
  if (result.length < 4) {
    throw new Error(`Invalid protocol id: ${protocolId}`);
  }

  const encoding = result.at(-1) as Encoding;
  if (!Object.values(Encoding).includes(encoding)) {
    throw new Error(`Invalid protocol encoding: ${encoding}`);
  }

  const versionStr = result.at(-2) as string;
  if (!/^-?[0-9]+$/.test(versionStr)) {
    throw new Error(`Invalid protocol version: ${versionStr}`);
  }

  // an ordinal version number (e.g. 1, 2, 3…).
  const version = parseInt(versionStr);

  // each request is identified by a name consisting of English alphabet, digits and underscores (_).
  const method = result.at(-3) as string;

  // messages are grouped into families identified by a shared libp2p protocol name prefix
  const protocolPrefix = result.slice(0, result.length - 3).join("/");

  return {
    protocolPrefix,
    method,
    version,
    encoding,
  };
}
