/**
 * Sink for `<response_chunk>*`, from
 * ```bnf
 * response ::= <response_chunk>*
 * ```
 * Collects a bounded list of responses up to `maxResponses`
 */
export async function collectMaxResponse<T>(source: AsyncIterable<T>, maxResponses: number): Promise<T[]> {
  // else: zero or more responses
  const responses: T[] = [];
  for await (const response of source) {
    responses.push(response);

    if (maxResponses !== undefined && responses.length >= maxResponses) {
      break;
    }
  }
  return responses;
}
