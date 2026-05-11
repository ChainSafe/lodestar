import {RequestError, RequestErrorCode} from "@lodestar/reqresp";

export function getRateLimitedUntilMs(e: unknown): number | null {
  if (!(e instanceof RequestError)) {
    return null;
  }

  switch (e.type.code) {
    case RequestErrorCode.RESP_RATE_LIMITED:
    case RequestErrorCode.REQUEST_SELF_RATE_LIMITED:
      return e.type.rateLimitedUntilMs ?? null;
    default:
      return null;
  }
}
