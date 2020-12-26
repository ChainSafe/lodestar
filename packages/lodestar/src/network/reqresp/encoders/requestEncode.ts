import {RequestBody} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Method, Methods, ReqRespEncoding} from "../../../constants";
import {writeEncodedPayload} from "../encodingStrategies";

/**
 * Yields byte chunks for a <request>
 * ```bnf
 * request  ::= <encoding-dependent-header> | <encoded-payload>
 * ```
 * Requests may contain no payload (e.g. /eth2/beacon_chain/req/metadata/1/)
 * if so, it would yield no byte chunks
 */
export async function* requestEncode(
  config: IBeaconConfig,
  method: Method,
  encoding: ReqRespEncoding,
  requestBody: RequestBody
): AsyncGenerator<Buffer> {
  const type = Methods[method].requestSSZType(config);

  if (type && requestBody !== null) {
    yield* writeEncodedPayload(requestBody, encoding, type);
  }
}
