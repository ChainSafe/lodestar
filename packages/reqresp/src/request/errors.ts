import {LodestarError, LodestarErrorObject} from "@lodestar/utils";
import {ResponseError} from "../response/index.js";
import {RespStatus, RpcResponseStatusError} from "../interface.js";

export enum RequestErrorCode {
  // Declaring specific values of RpcResponseStatusError for error clarity downstream
  /** `<response_chunk>` had `<result>` === INVALID_REQUEST */
  INVALID_REQUEST = "REQUEST_ERROR_INVALID_REQUEST",
  INVALID_RESPONSE_SSZ = "REQUEST_ERROR_INVALID_RESPONSE_SSZ",
  /** `<response_chunk>` had `<result>` === SERVER_ERROR */
  SERVER_ERROR = "REQUEST_ERROR_SERVER_ERROR",
  /** `<response_chunk>` had `<result>` === RESOURCE_UNAVAILABLE */
  RESOURCE_UNAVAILABLE = "RESOURCE_UNAVAILABLE_ERROR",
  /** `<response_chunk>` had a `<result>` not known in the current spec */
  UNKNOWN_ERROR_STATUS = "REQUEST_ERROR_UNKNOWN_ERROR_STATUS",
  /** Could not open a stream with peer before DIAL_TIMEOUT */
  DIAL_TIMEOUT = "REQUEST_ERROR_DIAL_TIMEOUT",
  /** Error opening a stream with peer */
  DIAL_ERROR = "REQUEST_ERROR_DIAL_ERROR",
  /** Reponder did not close write stream before REQUEST_TIMEOUT */
  REQUEST_TIMEOUT = "REQUEST_ERROR_REQUEST_TIMEOUT",
  /** Error when sending request to responder */
  REQUEST_ERROR = "REQUEST_ERROR_REQUEST_ERROR",
  /** Reponder did not deliver a full reponse before max maxTotalResponseTimeout() */
  RESPONSE_TIMEOUT = "REQUEST_ERROR_RESPONSE_TIMEOUT",
  /** A single-response method returned 0 chunks */
  EMPTY_RESPONSE = "REQUEST_ERROR_EMPTY_RESPONSE",
  /** Time to first byte timeout */
  TTFB_TIMEOUT = "REQUEST_ERROR_TTFB_TIMEOUT",
  /** Timeout between `<response_chunk>` exceed */
  RESP_TIMEOUT = "REQUEST_ERROR_RESP_TIMEOUT",
  /** Request rate limited */
  REQUEST_RATE_LIMITED = "REQUEST_ERROR_RATE_LIMITED",
  /** For malformed SSZ (metadata) responses */
  SSZ_OVER_MAX_SIZE = "SSZ_SNAPPY_ERROR_OVER_SSZ_MAX_SIZE",
}

type RequestErrorType =
  | {code: RequestErrorCode.INVALID_REQUEST; errorMessage: string}
  | {code: RequestErrorCode.INVALID_RESPONSE_SSZ; errorMessage: string}
  | {code: RequestErrorCode.SERVER_ERROR; errorMessage: string}
  | {code: RequestErrorCode.RESOURCE_UNAVAILABLE; errorMessage: string}
  | {code: RequestErrorCode.UNKNOWN_ERROR_STATUS; status: RpcResponseStatusError; errorMessage: string}
  | {code: RequestErrorCode.DIAL_TIMEOUT}
  | {code: RequestErrorCode.DIAL_ERROR; error: Error}
  | {code: RequestErrorCode.REQUEST_TIMEOUT}
  | {code: RequestErrorCode.REQUEST_ERROR; error: Error}
  | {code: RequestErrorCode.RESPONSE_TIMEOUT}
  | {code: RequestErrorCode.EMPTY_RESPONSE}
  | {code: RequestErrorCode.TTFB_TIMEOUT}
  | {code: RequestErrorCode.RESP_TIMEOUT}
  | {code: RequestErrorCode.REQUEST_RATE_LIMITED}
  | {code: RequestErrorCode.SSZ_OVER_MAX_SIZE};

export const REQUEST_ERROR_CLASS_NAME = "RequestError";

export class RequestError extends LodestarError<RequestErrorType> {
  constructor(type: RequestErrorType, message?: string, stack?: string) {
    super(type, message ?? renderErrorMessage(type), stack);
  }

  static fromObject(obj: LodestarErrorObject): RequestError {
    if (obj.className !== "RequestError") {
      throw new Error(`Expected className to be RequestError, but got ${obj.className}`);
    }

    return new RequestError(obj.type as RequestErrorType, obj.message, obj.stack);
  }
}

/**
 * Parse response status errors into detailed request errors for each status code for easier debugging
 */
export function responseStatusErrorToRequestError(e: ResponseError): RequestErrorType {
  const {errorMessage, status} = e;
  switch (status) {
    case RespStatus.INVALID_REQUEST:
      return {code: RequestErrorCode.INVALID_REQUEST, errorMessage};
    case RespStatus.SERVER_ERROR:
      return {code: RequestErrorCode.SERVER_ERROR, errorMessage};
    case RespStatus.RESOURCE_UNAVAILABLE:
      return {code: RequestErrorCode.RESOURCE_UNAVAILABLE, errorMessage};
    default:
      return {code: RequestErrorCode.UNKNOWN_ERROR_STATUS, errorMessage, status};
  }
}

/**
 * Render responder's errorMessage directly in main's error.message for easier debugging
 */
function renderErrorMessage(type: RequestErrorType): string | undefined {
  switch (type.code) {
    case RequestErrorCode.INVALID_REQUEST:
    case RequestErrorCode.SERVER_ERROR:
    case RequestErrorCode.RESOURCE_UNAVAILABLE:
    case RequestErrorCode.UNKNOWN_ERROR_STATUS:
      return `${type.code}: ${type.errorMessage}`;
    default:
      return type.code;
  }
}
