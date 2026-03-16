import {LodestarError, LodestarErrorObject} from "@lodestar/utils";
import {RespStatus, RpcResponseStatusError} from "../interface.js";
import {ResponseError} from "../response/index.js";

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
  /** A single-response method returned 0 chunks */
  EMPTY_RESPONSE = "REQUEST_ERROR_EMPTY_RESPONSE",
  /** Response transfer timeout exceeded */
  RESP_TIMEOUT = "REQUEST_ERROR_RESP_TIMEOUT",
  /** Request rate limited */
  REQUEST_RATE_LIMITED = "REQUEST_ERROR_RATE_LIMITED",
  /** Request self rate limited */
  REQUEST_SELF_RATE_LIMITED = "REQUEST_ERROR_SELF_RATE_LIMITED",
  /** Response rate limited */
  RESP_RATE_LIMITED = "RESPONSE_ERROR_RATE_LIMITED",
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
  | {code: RequestErrorCode.EMPTY_RESPONSE}
  | {code: RequestErrorCode.RESP_TIMEOUT}
  | {code: RequestErrorCode.REQUEST_RATE_LIMITED}
  | {code: RequestErrorCode.REQUEST_SELF_RATE_LIMITED}
  | {code: RequestErrorCode.RESP_RATE_LIMITED; backoffMs?: number}
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
  // Rate limit error detection: clients use different status codes and messages.
  // We match on the error message text because status codes are inconsistent:
  //   - Lighthouse/Grandine: status 139 (non-standard RateLimited code)
  //     message: "Rate limited. There are already 2 active requests with the same protocol"
  //   - Prysm: status 1 (INVALID_REQUEST), message: "rate limited"
  //   - Teku: status 1 (INVALID_REQUEST), message: "Peer has been rate limited"
  //   - Nimbus: never sends rate limit errors (silently throttles via token bucket)
  // See https://github.com/ChainSafe/lodestar/issues/8065#issuecomment-3157266196
  const errorMessageLowercase = errorMessage.toLowerCase();
  if (errorMessageLowercase.includes("rate limit")) {
    return {code: RequestErrorCode.RESP_RATE_LIMITED, backoffMs: parseBackoffSeconds(errorMessageLowercase)};
  }

  // Grandine's eth2_libp2p fork uses the old Lighthouse GCRA inbound rate limiter which sends
  // "Wait <Duration>" with an explicit backoff (e.g. "Wait 2.816488536s") using Rust's
  // Debug format for Duration. Lighthouse removed this in April 2025, switching to silent
  // response throttling, but Grandine still sends it.
  // See https://github.com/ChainSafe/lodestar/issues/8110
  if (errorMessageLowercase.includes("wait ")) {
    return {code: RequestErrorCode.RESP_RATE_LIMITED, backoffMs: parseBackoffSeconds(errorMessageLowercase)};
  }

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
 * Parse a backoff duration from a peer's rate limit error message.
 * Currently only Grandine sends a parseable duration (e.g. "Wait 2.816488536s"),
 * produced by Rust's `format!("Wait {:?}", duration)`. All other clients send
 * static messages with no backoff hint.
 *
 * Returns the duration in milliseconds, or undefined if no parseable duration is found
 * (in which case the caller falls back to DEFAULT_RATE_LIMIT_BACKOFF_MS).
 *
 * Input comes from untrusted remote peer error messages — the regex uses bounded
 * quantifiers and the input is truncated to defend against adversarial strings.
 */
export function parseBackoffSeconds(errorMessageLowercase: string): number | undefined {
  // Truncate to a sane length — real error messages are short, this prevents
  // the regex engine from scanning megabytes of attacker-controlled input
  const capped = errorMessageLowercase.length > 256 ? errorMessageLowercase.slice(0, 256) : errorMessageLowercase;

  // Bounded quantifiers (\d{1,6}, \d{1,9}) prevent matching absurdly long digit
  // strings that could produce huge intermediate values.
  // Matches: "2.816s", "30s", "2.816488536s", "30 seconds", "1 second", "5 sec"
  const match = capped.match(/(\d{1,6}(?:\.\d{1,9})?)\s*(?:s(?:ec(?:ond)?s?)?)\b/);
  if (match?.[1]) {
    const seconds = Number.parseFloat(match[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.ceil(seconds * 1000);
    }
  }
  return undefined;
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
