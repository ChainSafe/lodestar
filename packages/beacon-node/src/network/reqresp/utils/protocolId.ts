import {Encoding, protocolPrefix} from "../types.js";

/**
 * @param method `"beacon_blocks_by_range"`
 * @param version `"1"`
 * @param encoding `"ssz_snappy"`
 */
export function formatProtocolID(method: string, version: string, encoding: Encoding): string {
  return `${protocolPrefix}/${method}/${version}/${encoding}`;
}
