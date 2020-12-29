import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ResponseBody} from "@chainsafe/lodestar-types";
import {Method, Methods, ReqRespEncoding, RpcResponseStatus} from "../../../constants";
import {BufferedSource} from "../utils/bufferedSource";
import {readEncodedPayload} from "../encodingStrategies";
import {readErrorMessage, readResultHeader, StreamStatus} from "./resultHeader";
import {RequestInternalError, RequestErrorCode} from "./errors";

/**
 * Consumes a stream source to read a `<response>`
 * ```bnf
 * response        ::= <response_chunk>*
 * response_chunk  ::= <result> | <encoding-dependent-header> | <encoded-payload>
 * result          ::= "0" | "1" | "2" | ["128" ... "255"]
 * ```
 * Enforces RESP_TIMEOUT on each `<response_chunk>`
 */
export function responseDecode(
  config: IBeaconConfig,
  method: Method,
  encoding: ReqRespEncoding
): (source: AsyncIterable<Buffer>) => AsyncGenerator<ResponseBody> {
  return async function* (source) {
    const type = Methods[method].responseSSZType(config);
    const isSszTree = method === Method.BeaconBlocksByRange || method === Method.BeaconBlocksByRoot;

    const bufferedSource = new BufferedSource(source as AsyncGenerator<Buffer>);

    try {
      // Consumers of `responseDecode()` may limit the number of <response_chunk> and break out of the while loop
      while (!bufferedSource.isDone) {
        const status = await readResultHeader(bufferedSource);

        // Stream is only allowed to end at the start of a <response_chunk> block
        // The happens when source ends before readResultHeader() can fetch 1 byte
        if (status === StreamStatus.Ended) {
          return null;
        }

        // For multiple chunks, only the last chunk is allowed to have a non-zero error
        // code (i.e. The chunk stream is terminated once an error occurs
        if (status !== RpcResponseStatus.SUCCESS) {
          const errorMessage = await readErrorMessage(bufferedSource);
          switch (status) {
            case RpcResponseStatus.INVALID_REQUEST:
              throw new RequestInternalError({code: RequestErrorCode.INVALID_REQUEST, errorMessage});
            case RpcResponseStatus.SERVER_ERROR:
              throw new RequestInternalError({code: RequestErrorCode.SERVER_ERROR, errorMessage});
            default:
              throw new RequestInternalError({code: RequestErrorCode.UNKNOWN_ERROR_STATUS, errorMessage, status});
          }
        }

        yield await readEncodedPayload<ResponseBody>(bufferedSource, encoding, type, {isSszTree});
      }
    } finally {
      await bufferedSource.return();
    }
  };
}
