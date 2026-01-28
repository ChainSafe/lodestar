import {Uint8ArrayList} from "uint8arraylist";
import {encodePayload} from "../encodingStrategies/index.js";
import {MixedProtocol} from "../types.js";

/**
 * Encodes a request body to bytes ready for writing to stream.
 * Wire format:
 * ```bnf
 * request  ::= <varint-length> | <snappy-frames(ssz-payload)>
 * ```
 * Requests may contain no payload (e.g. /eth2/beacon_chain/req/metadata/1/)
 * in which case it returns an empty Uint8ArrayList.
 */
export function encodeRequest(protocol: MixedProtocol, requestBody: Uint8Array): Uint8ArrayList {
  const type = protocol.requestSizes;

  if (type && requestBody !== null && requestBody.length > 0) {
    return encodePayload(requestBody, protocol.encoding);
  }

  return new Uint8ArrayList();
}
