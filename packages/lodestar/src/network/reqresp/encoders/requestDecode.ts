import BufferList from "bl";
import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Method, Methods, ReqRespEncoding} from "../../../constants";
import {BufferedSource} from "../utils/bufferedSource";
import {readEncodedPayload} from "../encodingStrategies";

/**
 * Consumes a stream source to read a `<request>`
 * ```bnf
 * request  ::= <encoding-dependent-header> | <encoded-payload>
 * ```
 */
export function requestDecode(
  config: IBeaconConfig,
  method: Method,
  encoding: ReqRespEncoding
): (source: AsyncIterable<Buffer | BufferList>) => Promise<phase0.RequestBody> {
  return async function (source) {
    const type = Methods[method].requestSSZType(config);
    if (!type) {
      // method has no body
      return null;
    }

    // Request has a single payload, so return immediately
    const bufferedSource = new BufferedSource(source as AsyncGenerator<Buffer>);
    return await readEncodedPayload<phase0.RequestBody>(bufferedSource, encoding, type);
  };
}
