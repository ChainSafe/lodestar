import {Protocol, getRequestSzzTypeByMethod, RequestBody} from "../types";
import {writeEncodedPayload} from "../encodingStrategies";

/**
 * Yields byte chunks for a `<request>`
 * ```bnf
 * request  ::= <encoding-dependent-header> | <encoded-payload>
 * ```
 * Requests may contain no payload (e.g. /eth2/beacon_chain/req/metadata/1/)
 * if so, it would yield no byte chunks
 */
export async function* requestEncode(
  protocol: Pick<Protocol, "method" | "encoding">,
  requestBody: RequestBody
): AsyncGenerator<Buffer> {
  const type = getRequestSzzTypeByMethod(protocol.method);

  if (type && requestBody !== null) {
    yield* writeEncodedPayload(requestBody, protocol.encoding, type);
  }
}
