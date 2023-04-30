import {MixedProtocol} from "../types.js";
import {writeEncodedPayload} from "../encodingStrategies/index.js";

/**
 * Yields byte chunks for a `<request>`
 * ```bnf
 * request  ::= <encoding-dependent-header> | <encoded-payload>
 * ```
 * Requests may contain no payload (e.g. /eth2/beacon_chain/req/metadata/1/)
 * if so, it would yield no byte chunks
 */
export async function* requestEncode(protocol: MixedProtocol, requestBody: Uint8Array): AsyncGenerator<Buffer> {
  const type = protocol.requestSizes;

  if (type && requestBody !== null) {
    yield* writeEncodedPayload(requestBody, protocol.encoding);
  }
}
