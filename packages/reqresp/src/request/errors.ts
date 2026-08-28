import {LodestarError, LodestarErrorObject} from "@lodestar/utils";
import {RespStatus, RpcResponseStatusError} from "../interface.js";
import {DEFAULT_RATE_LIMIT_BACKOFF_MS} from "../rate_limiter/selfRateLimiter.js";
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

export type RequestErrorType =
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
  | {code: RequestErrorCode.REQUEST_SELF_RATE_LIMITED; rateLimitedUntilMs?: number}
  | {code: RequestErrorCode.RESP_RATE_LIMITED; rateLimitedUntilMs: number}
  | {code: RequestErrorCode.SSZ_OVER_MAX_SIZE};

export const REQUEST_ERROR_CLASS_NAME = "RequestError";

export class RequestError extends LodestarError<RequestErrorType> {
  constructor(type: RequestErrorType, message?: string, stack?: string) {
    super(withInnerError(type), message ?? renderErrorMessage(type), stack);
  }

  static fromObject(obj: LodestarErrorObject): RequestError {
    if (obj.className !== "RequestError") {
      throw new Error(`Expected className to be RequestError, but got ${obj.className}`);
    }

    return new RequestError(obj.type as RequestErrorType, obj.message, obj.stack);
  }
}

/**
 * `DIAL_ERROR` and `REQUEST_ERROR` declare `error: Error`, but nothing enforces that at runtime:
 *  - Bun rejects an aborted dial with an abort `Event` (`{type: "abort", isTrusted, local}`) instead
 *    of an `AbortError`, so the value reaching `new RequestError()` is not an `Error`.
 *  - `fromObject` rebuilds the type from a thread-boundary clone, which does not preserve `Error`.
 *
 * Consumers trust the declared type and read the inner error directly (peer scoring does
 * `e.type.error.message.includes(...)`), so a non-`Error` there throws a secondary `TypeError` that
 * escapes as an uncaught exception. Normalize once in the constructor, the single point every
 * `RequestError` is built, so the declared type is true for every consumer.
 *
 * See https://github.com/ChainSafe/lodestar/issues/9900
 */
function withInnerError(type: RequestErrorType): RequestErrorType {
  if (type.code !== RequestErrorCode.DIAL_ERROR && type.code !== RequestErrorCode.REQUEST_ERROR) {
    return type;
  }

  const error = type.error as unknown;
  return error instanceof Error ? type : {...type, error: toError(error)};
}

/**
 * Best-effort `Error` from an unknown thrown value, keeping whatever detail it carries so the
 * original cause stays greppable in logs. `type` covers `Event`-like values (Bun's abort).
 */
function toError(value: unknown): Error {
  const detail =
    (value as {message?: unknown; type?: unknown} | null | undefined)?.message ??
    (value as {type?: unknown} | null | undefined)?.type;
  return new Error(typeof detail === "string" && detail !== "" ? detail : String(value));
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
    return {code: RequestErrorCode.RESP_RATE_LIMITED, rateLimitedUntilMs: Date.now() + DEFAULT_RATE_LIMIT_BACKOFF_MS};
  }

  // Grandine's eth2_libp2p fork uses the old Lighthouse GCRA inbound rate limiter which sends
  // "Wait <Duration>" with an explicit backoff (e.g. "Wait 2.816488536s") using Rust's
  // Debug format for Duration. We only use this as a rate-limit signal; the backoff duration
  // is intentionally not parsed.
  // See https://github.com/ChainSafe/lodestar/issues/8110
  if (errorMessageLowercase.startsWith("wait ")) {
    return {code: RequestErrorCode.RESP_RATE_LIMITED, rateLimitedUntilMs: Date.now() + DEFAULT_RATE_LIMIT_BACKOFF_MS};
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
