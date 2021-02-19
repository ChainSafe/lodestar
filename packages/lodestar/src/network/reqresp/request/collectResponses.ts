import {phase0} from "@chainsafe/lodestar-types";
import {Method} from "../../../constants";
import {isRequestSingleChunk} from "../../util";
import {RequestErrorCode, RequestInternalError} from "./errors";

/**
 * Sink for `<response_chunk>*`, from
 * ```bnf
 * response ::= <response_chunk>*
 * ```
 * Note: `response` has zero or more chunks for SSZ-list responses or exactly one chunk for non-list
 */
export function collectResponses<T extends phase0.ResponseBody | phase0.ResponseBody[]>(
  method: Method,
  maxResponses?: number
): (source: AsyncIterable<phase0.ResponseBody>) => Promise<T> {
  return async (source) => {
    if (isRequestSingleChunk(method)) {
      for await (const response of source) {
        return response as T;
      }
      throw new RequestInternalError({code: RequestErrorCode.EMPTY_RESPONSE});
    }

    // else: zero or more responses
    const responses: phase0.ResponseBody[] = [];
    for await (const response of source) {
      responses.push(response);

      if (maxResponses && responses.length >= maxResponses) {
        break;
      }
    }
    return responses as T;
  };
}
