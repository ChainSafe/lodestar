import {AbortSignal} from "abort-controller";
import {LodestarError, withTimeout} from "@chainsafe/lodestar-utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ResponseBody} from "@chainsafe/lodestar-types";
import {
  Method,
  Methods,
  ReqRespEncoding,
  RESP_TIMEOUT,
  RpcResponseStatus,
  RpcResponseStatusError,
} from "../../../constants";
import {BufferedSource} from "../utils/bufferedSource";
import {readEncodedPayload} from "../encodingStrategies";
import {readErrorMessage, readResultHeader} from "./resultHeader";

/**
 * Consumes a stream source to read a <response>
 * ```bnf
 * response        ::= <response_chunk>*
 * response_chunk  ::= <result> | <encoding-dependent-header> | <encoded-payload>
 * result          ::= "0" | "1" | "2" | ["128" ... "255"]
 * ```
 */
export function responseDecode(
  config: IBeaconConfig,
  method: Method,
  encoding: ReqRespEncoding,
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
              throw new ResponseStatusError({code: "RESPONSE_STATUS_ERROR", status, errorMessage});
            }

            return await readEncodedPayload(bufferedSource, encoding, type, {isSszTree});
          },
          RESP_TIMEOUT,
          signal
        );
      }
    } catch (e) {
      const metadata = {method, encoding};
      if (e instanceof ResponseStatusError) {
        const {status, errorMessage} = e.type;
        switch (status) {
          case RpcResponseStatus.INVALID_REQUEST:
            throw new ResponseError({code: ResponseErrorCode.INVALID_REQUEST, errorMessage, ...metadata});
          case RpcResponseStatus.SERVER_ERROR:
            throw new ResponseError({code: ResponseErrorCode.SERVER_ERROR, errorMessage, ...metadata});
          default:
            throw new ResponseError({code: ResponseErrorCode.UNKNOWN_ERROR_STATUS, errorMessage, status, ...metadata});
        }
      } else {
        throw e;
        // ### TODO: What's the best error strategy here? Wrap or not
        // throw new ResponseError({code: ResponseErrorCode.OTHER_ERROR, error: e, ...metadata});
      }
    } finally {
      await bufferedSource.return();
    }
  };
}

/**
 * Intermediate error exclusively used for flow control in `responseDecode()` fn
 * It must be re-thrown as a ResponseError
 */
class ResponseStatusError extends LodestarError<ResponseStatusErrorType> {
  constructor(type: ResponseStatusErrorType) {
    super(type);
  }
}

type ResponseStatusErrorType = {
  code: "RESPONSE_STATUS_ERROR";
  status: RpcResponseStatusError;
  errorMessage: string;
};

export enum ResponseErrorCode {
  // Declaring specific values of RpcResponseStatusError for error clarity downstream
  /** <response_chunk> had <result> === INVALID_REQUEST */
  INVALID_REQUEST = "RESPONSE_ERROR_INVALID_REQUEST",
  /** <response_chunk> had <result> === SERVER_ERROR */
  SERVER_ERROR = "RESPONSE_ERROR_SERVER_ERROR",
  /** <response_chunk> had a <result> not known in the current spec */
  UNKNOWN_ERROR_STATUS = "RESPONSE_ERROR_UNKNOWN_ERROR_STATUS",
  /** Stream ended expecting to read <result> spec */
  ENDED_ON_RESULT = "RESPONSE_ERROR_ENDED_ON_RESULT",
  /** Any other error */
  OTHER_ERROR = "RESPONSE_ERROR",
}

type ResponseErrorType =
  | {code: ResponseErrorCode.INVALID_REQUEST; errorMessage: string}
  | {code: ResponseErrorCode.SERVER_ERROR; errorMessage: string}
  | {code: ResponseErrorCode.UNKNOWN_ERROR_STATUS; status: RpcResponseStatusError; errorMessage: string}
  | {code: ResponseErrorCode.OTHER_ERROR; error: Error};

interface IResponseMetadata {
  method: Method;
  encoding: ReqRespEncoding;
}

export class ResponseError extends LodestarError<ResponseErrorType & IResponseMetadata> {
  constructor(type: ResponseErrorType & IResponseMetadata) {
    super(type);
  }
}
