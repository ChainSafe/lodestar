import {RequestError, RequestErrorCode} from "@lodestar/reqresp";
import {RATE_LIMITED_PEER_BACKOFF_MS} from "../constants.js";

export function getRateLimitedUntilMs(e: unknown): number | null {
  if (!(e instanceof RequestError)) {
    return null;
  }

  switch (e.type.code) {
    case RequestErrorCode.RESP_RATE_LIMITED:
    case RequestErrorCode.REQUEST_SELF_RATE_LIMITED:
      return e.type.rateLimitedUntilMs ?? Date.now() + RATE_LIMITED_PEER_BACKOFF_MS;
    default:
      return null;
  }
}
