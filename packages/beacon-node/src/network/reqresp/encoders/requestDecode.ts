import BufferList from "bl";
import {Sink} from "it-stream-types";
import {getRequestSzzTypeByMethod, Protocol, RequestBody} from "../types.js";
import {BufferedSource} from "../utils/index.js";
import {readEncodedPayload} from "../encodingStrategies/index.js";
/**
 * Consumes a stream source to read a `<request>`
 * ```bnf
 * request  ::= <encoding-dependent-header> | <encoded-payload>
 * ```
 */
export function requestDecode(
  protocol: Pick<Protocol, "method" | "encoding">
): Sink<Buffer | BufferList, Promise<RequestBody>> {
  return async function requestDecodeSink(source) {
    const type = getRequestSzzTypeByMethod(protocol.method);
    if (!type) {
      // method has no body
      return null;
    }

    // Request has a single payload, so return immediately
    const bufferedSource = new BufferedSource(source as AsyncGenerator<Buffer>);
    return await readEncodedPayload(bufferedSource, protocol.encoding, type);
  };
}
