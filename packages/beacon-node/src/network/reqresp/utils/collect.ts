import {ResponseIncoming, RequestErrorCode, RequestError} from "@lodestar/reqresp";
import {Type} from "@chainsafe/ssz";
import {ResponseTypeGetter} from "../types.js";

/**
 * Sink for `<response_chunk>*`, from
 * ```bnf
 * response ::= <response_chunk>*
 * ```
 * Expects exactly one response
 */
export async function collectExactOneTyped<T>(
  source: AsyncIterable<ResponseIncoming>,
  typeFn: ResponseTypeGetter<T>
): Promise<T> {
  for await (const chunk of source) {
    const type = typeFn(chunk.fork, chunk.protocolVersion);
    const response = sszDeserializeResponse(type, chunk.data);
    return response;
  }
  throw new RequestError({code: RequestErrorCode.EMPTY_RESPONSE});
}

/**
 * Sink for `<response_chunk>*`, from
 * ```bnf
 * response ::= <response_chunk>*
 * ```
 * Collects a bounded list of responses up to `maxResponses`
 */
export async function collectMaxResponseTyped<T>(
  source: AsyncIterable<ResponseIncoming>,
  maxResponses: number,
  typeFn: ResponseTypeGetter<T>
): Promise<T[]> {
  // else: zero or more responses
  const responses: T[] = [];
  for await (const chunk of source) {
    const type = typeFn(chunk.fork, chunk.protocolVersion);
    const response = sszDeserializeResponse(type, chunk.data);
    responses.push(response);

    if (maxResponses !== undefined && responses.length >= maxResponses) {
      break;
    }
  }
  return responses;
}

/** Light wrapper on type to wrap deserialize errors */
export function sszDeserializeResponse<T>(type: Type<T>, bytes: Uint8Array): T {
  try {
    return type.deserialize(bytes);
  } catch (e) {
    throw new RequestError({code: RequestErrorCode.INVALID_RESPONSE_SSZ, errorMessage: (e as Error).message});
  }
}
