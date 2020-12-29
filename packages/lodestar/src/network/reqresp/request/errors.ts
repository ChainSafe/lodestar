import {LodestarError} from "@chainsafe/lodestar-utils";
import {Method, ReqRespEncoding, RpcResponseStatusError} from "../../../constants";

export enum RequestErrorCode {
  // Declaring specific values of RpcResponseStatusError for error clarity downstream
  /** `<response_chunk>` had `<result>` === INVALID_REQUEST */
  INVALID_REQUEST = "REQUEST_ERROR_INVALID_REQUEST",
  /** `<response_chunk>` had `<result>` === SERVER_ERROR */
  SERVER_ERROR = "REQUEST_ERROR_SERVER_ERROR",
  /** `<response_chunk>` had a `<result>` not known in the current spec */
  UNKNOWN_ERROR_STATUS = "REQUEST_ERROR_UNKNOWN_ERROR_STATUS",
  /** Stream ended expecting to read `<result>` spec */
  ENDED_ON_RESULT = "REQUEST_ERROR_ENDED_ON_RESULT",
  /** Could not open a stream with peer before DIAL_TIMEOUT */
  DIAL_TIMEOUT = "REQUEST_ERROR_DIAL_TIMEOUT",
  /** Error opening a stream with peer */
  DIAL_ERROR = "REQUEST_ERROR_DIAL_ERROR",
  /** Reponder did not close write stream before REQUEST_TIMEOUT */
  REQUEST_TIMEOUT = "REQUEST_ERROR_REQUEST_TIMEOUT",
  /** Error when sending request to responder */
  REQUEST_ERROR = "REQUEST_ERROR_REQUEST_ERROR",
  /** Time to first byte timeout */
  TTFB_TIMEOUT = "REQUEST_ERROR_TTFB_TIMEOUT",
  /** Timeout between `<response_chunk>` exceed */
  RESP_TIMEOUT = "REQUEST_ERROR_RESP_TIMEOUT",
  /** Any other error */
  OTHER_ERROR = "REQUEST_ERROR",
}

type RequestErrorType =
  | {code: RequestErrorCode.INVALID_REQUEST; errorMessage: string}
  | {code: RequestErrorCode.SERVER_ERROR; errorMessage: string}
  | {code: RequestErrorCode.UNKNOWN_ERROR_STATUS; status: RpcResponseStatusError; errorMessage: string}
  | {code: RequestErrorCode.ENDED_ON_RESULT}
  | {code: RequestErrorCode.DIAL_TIMEOUT}
  | {code: RequestErrorCode.DIAL_ERROR; error: Error}
  | {code: RequestErrorCode.REQUEST_TIMEOUT}
  | {code: RequestErrorCode.REQUEST_ERROR; error: Error}
  | {code: RequestErrorCode.TTFB_TIMEOUT}
  | {code: RequestErrorCode.RESP_TIMEOUT}
  | {code: RequestErrorCode.OTHER_ERROR; error: Error};

interface IRequestMetadata {
  method: Method;
  encoding: ReqRespEncoding;
  peer: string;
  // Do not include requestId in error metadata to make the errors deterministic for tests
}

/**
 * Same error types as RequestError but without metadata.
 * Top level function sendRequest() must rethrow RequestInternalError with metadata
 */
export class RequestInternalError extends LodestarError<RequestErrorType> {
  constructor(type: RequestErrorType) {
    super(type, renderErrorMessage(type));
  }
}

export class RequestError extends LodestarError<RequestErrorType & IRequestMetadata> {
  constructor(type: RequestErrorType & IRequestMetadata) {
    super(type, renderErrorMessage(type));
  }
}

function renderErrorMessage(type: RequestErrorType): string {
  switch (type.code) {
    case RequestErrorCode.INVALID_REQUEST:
    case RequestErrorCode.SERVER_ERROR:
      return `${type.code}: ${type.errorMessage}`;

    default:
      return type.code;
  }
}
