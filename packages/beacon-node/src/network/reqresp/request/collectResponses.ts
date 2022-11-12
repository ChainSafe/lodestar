import {ProtocolDefinition} from "../types.js";
import {RequestErrorCode, RequestInternalError} from "./errors.js";

/**
 * Sink for `<response_chunk>*`, from
 * ```bnf
 * response ::= <response_chunk>*
 * ```
 * Note: `response` has zero or more chunks for SSZ-list responses or exactly one chunk for non-list
 */
export function collectResponses<T>(
  protocol: ProtocolDefinition,
  maxResponses?: number
): (source: AsyncIterable<T>) => Promise<T | T[]> {
  return async (source) => {
    if (protocol.isSingleResponse) {
      for await (const response of source) {
        return response;
      }
      throw new RequestInternalError({code: RequestErrorCode.EMPTY_RESPONSE});
    }

    // else: zero or more responses
    const responses: T[] = [];
    for await (const response of source) {
      responses.push(response);

      if (maxResponses !== undefined && responses.length >= maxResponses) {
        break;
      }
    }
    return responses;
  };
}
