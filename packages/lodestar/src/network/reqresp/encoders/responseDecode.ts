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
import {readChunk} from "../encodingStrategies";
import {readErrorMessage, readResultHeader} from "./resultHeader";

// request         ::= <encoding-dependent-header> | <encoded-payload>
// response        ::= <response_chunk>*
// response_chunk  ::= <result> | <encoding-dependent-header> | <encoded-payload>
// result          ::= “0” | “1” | “2” | [“128” ... ”255”]

// `response` has zero or more chunks for SSZ-list responses or exactly one chunk for non-list

export function responseDecode(
  config: IBeaconConfig,
  method: Method,
  encoding: ReqRespEncoding,
  signal?: AbortSignal
): (source: AsyncIterable<Buffer>) => AsyncGenerator<ResponseBody> {
  return async function* (source) {
    const type = Methods[method].responseSSZType(config);
    const isSszTree = method === Method.BeaconBlocksByRange || method === Method.BeaconBlocksByRoot;

    // A requester SHOULD read from the stream until either:
    // 1. An error result is received in one of the chunks (the error payload MAY be read before stopping).
    // 2. The responder closes the stream.
    // 3. Any part of the response_chunk fails validation.
    // 4. The maximum number of requested chunks are read.

    const bufferedSource = new BufferedSource(source as AsyncGenerator<Buffer>);

    try {
      // After the first byte, the requester allows a further RESP_TIMEOUT for each subsequent response_chunk received
      // If any of these timeouts fire, the requester SHOULD reset the stream and deem the req/resp operation to have failed.

      // collectResponses limits the number or response chunks
      // Stream is only allowed to end here. Make sure the stream has data before looping again
      while (await bufferedSource.hasData()) {
        yield await withTimeout(
          async () => {
            const status = await readResultHeader(bufferedSource);

            // For multiple chunks, only the last chunk is allowed to have a non-zero error
            // code (i.e. The chunk stream is terminated once an error occurs
            if (status !== RpcResponseStatus.SUCCESS) {
              const errorMessage = await readErrorMessage(bufferedSource);
              throw new ResponseStatusError({code: "RESPONSE_STATUS_ERROR", status, errorMessage});
            }

            return await readChunk(bufferedSource, encoding, type, {isSszTree});
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
        throw new ResponseError({code: ResponseErrorCode.OTHER_ERROR, error: e, ...metadata});
      }
    } finally {
      await bufferedSource.return();
    }
  };
}

/**
 * Intermediate error exclusively used for flow control in responseDecode fn
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
  /** Response had status !== SUCCESS */
  INVALID_REQUEST = "RESPONSE_ERROR_INVALID_REQUEST",
  SERVER_ERROR = "RESPONSE_ERROR_SERVER_ERROR",
  UNKNOWN_ERROR_STATUS = "RESPONSE_ERROR_UNKNOWN_ERROR_STATUS",
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
