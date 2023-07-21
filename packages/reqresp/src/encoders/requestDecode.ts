import type {Sink} from "it-stream-types";
import {Uint8ArrayList} from "uint8arraylist";
import {MixedProtocol} from "../types.js";
import {BufferedSource} from "../utils/index.js";
import {readEncodedPayload} from "../encodingStrategies/index.js";

const EMPTY_DATA = new Uint8Array();

/**
 * Consumes a stream source to read a `<request>`
 * ```bnf
 * request  ::= <encoding-dependent-header> | <encoded-payload>
 * ```
 */
export function requestDecode(
  protocol: MixedProtocol
): Sink<AsyncIterable<Uint8Array | Uint8ArrayList>, Promise<Uint8Array>> {
  return async function requestDecodeSink(source) {
    const type = protocol.requestSizes;
    if (type === null) {
      // method has no body
      return EMPTY_DATA;
    }

    // Request has a single payload, so return immediately
    const bufferedSource = new BufferedSource(source as AsyncGenerator<Uint8ArrayList>);
    return readEncodedPayload(bufferedSource, protocol.encoding, type);
  };
}
