import {LodestarError} from "@chainsafe/lodestar-utils";
import {Method, ReqRespEncoding, RpcResponseStatusError} from "../../../constants";

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
  /** Time to first byte timeout */
  TTFB_TIMEOUT = "RESPONSE_ERROR_TTFB_TIMEOUT",
  /** Any other error */
  OTHER_ERROR = "RESPONSE_ERROR",
}

type ResponseErrorType =
  | {code: ResponseErrorCode.INVALID_REQUEST; errorMessage: string}
  | {code: ResponseErrorCode.SERVER_ERROR; errorMessage: string}
  | {code: ResponseErrorCode.UNKNOWN_ERROR_STATUS; status: RpcResponseStatusError; errorMessage: string}
  | {code: ResponseErrorCode.ENDED_ON_RESULT}
  | {code: ResponseErrorCode.TTFB_TIMEOUT}
  | {code: ResponseErrorCode.OTHER_ERROR; error: Error};

interface IResponseMetadata {
  method: Method;
  encoding: ReqRespEncoding;
}

/**
 * Same error types as ResponseError but without metadata
 * Top level function sendRequest() must rethrow ResponseInternalError with metadata
 */
export class ResponseInternalError extends LodestarError<ResponseErrorType> {
  constructor(type: ResponseErrorType) {
    super(type);
  }
}

export class ResponseError extends LodestarError<ResponseErrorType & IResponseMetadata> {
  constructor(type: ResponseErrorType & IResponseMetadata) {
    super(type);
  }
}
