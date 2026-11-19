import {Type} from "@chainsafe/ssz";
import {RequestError, RequestErrorCode} from "@lodestar/reqresp";
import {SerializedCache} from "../../../util/serializedCache.js";
import {ResponseIncoming, ResponseTypeGetter} from "../types.js";

/**
 * Sink for `<response_chunk>*`, from
 * ```bnf
 * response ::= <response_chunk>*
 * ```
 * Expects exactly one response
 */
export async function collectExactOneTyped<T>(
  source: AsyncIterable<ResponseIncoming>,
  typeFn: ResponseTypeGetter<T>,
  onInvalidResponse?: (chunk: ResponseIncoming) => void
): Promise<T> {
  for await (const chunk of source) {
    const type = typeFn(chunk.fork, chunk.protocolVersion);
    const response = sszDeserializeResponse(type, chunk, onInvalidResponse);
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
  typeFn: ResponseTypeGetter<T>,
  serializedCache?: SerializedCache,
  onInvalidResponse?: (chunk: ResponseIncoming) => void
): Promise<T[]> {
  // else: zero or more responses
  const responses: T[] = [];
  for await (const chunk of source) {
    const type = typeFn(chunk.fork, chunk.protocolVersion);
    const response = sszDeserializeResponse(type, chunk, onInvalidResponse);
    // optionally cache the serialized response if the cache is available
    serializedCache?.set(response as object, chunk.data);
    responses.push(response);

    if (maxResponses !== undefined && responses.length >= maxResponses) {
      break;
    }
  }
  return responses;
}

/**
 * Sink for `<response_chunk>*`, from
 * ```bnf
 * response ::= <response_chunk>*
 * ```
 * Collects a bounded list of responses up to `maxResponses`
 */
export async function collectMaxResponseTypedWithBytes<T>(
  source: AsyncIterable<ResponseIncoming>,
  maxResponses: number,
  typeFn: ResponseTypeGetter<T>,
  serializedCache?: SerializedCache,
  onInvalidResponse?: (chunk: ResponseIncoming) => void
): Promise<T[]> {
  // else: zero or more responses
  const responses: T[] = [];
  for await (const chunk of source) {
    const type = typeFn(chunk.fork, chunk.protocolVersion);
    const data = sszDeserializeResponse(type, chunk, onInvalidResponse);
    responses.push(data);
    // optionally cache the serialized response if the cache is available
    serializedCache?.set(data as object, chunk.data);

    if (maxResponses !== undefined && responses.length >= maxResponses) {
      break;
    }
  }
  return responses;
}

/** Light wrapper on type to wrap deserialize errors */
export function sszDeserializeResponse<T>(
  type: Type<T>,
  chunk: ResponseIncoming,
  onInvalidResponse?: (chunk: ResponseIncoming) => void
): T {
  try {
    return type.deserialize(chunk.data);
  } catch (e) {
    onInvalidResponse?.(chunk);
    throw new RequestError({code: RequestErrorCode.INVALID_RESPONSE_SSZ, errorMessage: (e as Error).message});
  }
}
