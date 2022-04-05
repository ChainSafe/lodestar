import {Method, isSingleResponseChunkByMethod, IncomingResponseBody} from "../types";
import {RequestErrorCode, RequestInternalError} from "./errors";

/**
 * Sink for `<response_chunk>*`, from
 * ```bnf
 * response ::= <response_chunk>*
 * ```
 * Note: `response` has zero or more chunks for SSZ-list responses or exactly one chunk for non-list
 */
export function collectResponses<T extends IncomingResponseBody | IncomingResponseBody[]>(
  method: Method,
  maxResponses?: number
): (source: AsyncIterable<IncomingResponseBody>) => Promise<T> {
  return async (source) => {
    if (isSingleResponseChunkByMethod[method]) {
      for await (const response of source) {
        return response as T;
      }
      throw new RequestInternalError({code: RequestErrorCode.EMPTY_RESPONSE});
    }

    // else: zero or more responses
    const responses: IncomingResponseBody[] = [];
    for await (const response of source) {
      responses.push(response);

      if (maxResponses !== undefined && responses.length >= maxResponses) {
        break;
      }
    }
    return responses as T;
  };
}
