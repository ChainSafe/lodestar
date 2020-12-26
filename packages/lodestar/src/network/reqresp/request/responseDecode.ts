import {AbortSignal} from "abort-controller";
import {TimeoutError, withTimeout} from "@chainsafe/lodestar-utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ResponseBody} from "@chainsafe/lodestar-types";
import {Method, Methods, ReqRespEncoding, RpcResponseStatus} from "../../../constants";
import {BufferedSource} from "../utils/bufferedSource";
import {readEncodedPayload} from "../encodingStrategies";
import {readErrorMessage, readResultHeader} from "./resultHeader";
import {ResponseInternalError, ResponseErrorCode} from "./errors";

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
  encoding: ReqRespEncoding,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  RESP_TIMEOUT: number,
  signal?: AbortSignal
): (source: AsyncIterable<Buffer>) => AsyncGenerator<ResponseBody> {
  return async function* (source) {
    const type = Methods[method].responseSSZType(config);
    const isSszTree = method === Method.BeaconBlocksByRange || method === Method.BeaconBlocksByRoot;

    const bufferedSource = new BufferedSource(source as AsyncGenerator<Buffer>);

    try {
      // > Consumers of `responseDecode()` may limit the number of <response_chunk> and break out of the while loop
      // > Stream is only allowed to end at the start of the stream of after reading a <response_chunk> in full
      //   Make sure the stream has data before attempting to decode the <encoding-dependent-header>
      while (await bufferedSource.hasData()) {
        // After the first byte, the requester allows a further RESP_TIMEOUT for each subsequent response_chunk received
        // If any of these timeouts fire, the requester SHOULD reset the stream and deem the req/resp operation to have failed.
        yield await withTimeout(
          async () => {
            const status = await readResultHeader(bufferedSource);

            // For multiple chunks, only the last chunk is allowed to have a non-zero error
            // code (i.e. The chunk stream is terminated once an error occurs
            if (status !== RpcResponseStatus.SUCCESS) {
              const errorMessage = await readErrorMessage(bufferedSource);
              switch (status) {
                case RpcResponseStatus.INVALID_REQUEST:
                  throw new ResponseInternalError({code: ResponseErrorCode.INVALID_REQUEST, errorMessage});
                case RpcResponseStatus.SERVER_ERROR:
                  throw new ResponseInternalError({code: ResponseErrorCode.SERVER_ERROR, errorMessage});
                default:
                  throw new ResponseInternalError({code: ResponseErrorCode.UNKNOWN_ERROR_STATUS, errorMessage, status});
              }
            }

            return await readEncodedPayload<ResponseBody>(bufferedSource, encoding, type, {isSszTree});
          },
          RESP_TIMEOUT,
          signal
        ).catch((e) => {
          if (e instanceof TimeoutError) {
            throw new ResponseInternalError({code: ResponseErrorCode.RESP_TIMEOUT});
          } else {
            throw e;
          }
        });
      }
    } finally {
      await bufferedSource.return();
    }
  };
}
