import {RequestErrorCode, RequestError} from "../request/errors.js";

/**
 * Sink for `<response_chunk>*`, from
 * ```bnf
 * response ::= <response_chunk>*
 * ```
 * Expects exactly one response
 */
export async function collectExactOne<T>(source: AsyncIterable<T>): Promise<T> {
  for await (const response of source) {
    return response;
  }
  throw new RequestError({code: RequestErrorCode.EMPTY_RESPONSE});
}
