import {Sink} from "it-stream-types";
import {Uint8ArrayList} from "uint8arraylist";
import {ForkName} from "@lodestar/params";
import {ProtocolDefinition} from "../types.js";
import {BufferedSource} from "../utils/index.js";
import {readEncodedPayload} from "../encodingStrategies/index.js";
/**
 * Consumes a stream source to read a `<request>`
 * ```bnf
 * request  ::= <encoding-dependent-header> | <encoded-payload>
 * ```
 */
export function requestDecode<Req, Resp>(
  protocol: ProtocolDefinition<Req, Resp>
): Sink<Uint8Array | Uint8ArrayList, Promise<Req>> {
  return async function requestDecodeSink(source) {
    const type = protocol.requestType(ForkName.phase0);
    if (type === null) {
      // method has no body
      return (null as unknown) as Req;
    }

    // Request has a single payload, so return immediately
    const bufferedSource = new BufferedSource(source as AsyncGenerator<Uint8ArrayList>);
    return readEncodedPayload(bufferedSource, protocol.encoding, type);
  };
}
