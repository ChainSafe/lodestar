import {Uint8ArrayList} from "uint8arraylist";
import {readEncodedPayload} from "../encodingStrategies/index.js";
import {MixedProtocol} from "../types.js";
import {BufferedSource} from "../utils/index.js";

const EMPTY_DATA = new Uint8Array();

/**
 * Consumes a stream source to read a `<request>`
 * ```bnf
 * request  ::= <encoding-dependent-header> | <encoded-payload>
 * ```
 */
export async function requestDecode(
  protocol: MixedProtocol,
  source: AsyncIterable<Uint8Array | Uint8ArrayList>
): Promise<Uint8Array> {
  const type = protocol.requestSizes;
  if (type === null) {
    // method has no body
    return EMPTY_DATA;
  }

  // Request has a single payload, so return immediately
  const bufferedSource = new BufferedSource(source[Symbol.asyncIterator]() as AsyncGenerator<Uint8ArrayList>);
  return readEncodedPayload(bufferedSource, protocol.encoding, type);
}
