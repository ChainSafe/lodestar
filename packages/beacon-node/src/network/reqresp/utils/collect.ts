import {Type} from "@chainsafe/ssz";
import {RequestError, RequestErrorCode, ResponseIncoming} from "@lodestar/reqresp";
import {SerializedCache} from "../../../util/serializedCache.js";
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
  typeFn: ResponseTypeGetter<T>,
  serializedCache?: SerializedCache
): Promise<T[]> {
  // else: zero or more responses
  const responses: T[] = [];
  for await (const chunk of source) {
    const type = typeFn(chunk.fork, chunk.protocolVersion);
    const response = sszDeserializeResponse(type, chunk.data);
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
export async function collectMaxResponseTypedWithBytes<T, R>(
  source: AsyncIterable<ResponseIncoming>,
  maxResponses: number,
  typeFn: ResponseTypeGetter<T>,
  mapResponse: (data: T, bytes: Uint8Array) => R
): Promise<R[]> {
  // else: zero or more responses
  const responses: R[] = [];
  for await (const chunk of source) {
    const type = typeFn(chunk.fork, chunk.protocolVersion);
    // TODO - beacon engine: revisit reuseBytes after https://github.com/ChainSafe/ssz/issues/559 is fixed.
    const data = sszDeserializeResponse(type, chunk.data, {reuseBytes: false});
    responses.push(mapResponse(data, chunk.data));

    if (maxResponses !== undefined && responses.length >= maxResponses) {
      break;
    }
  }
  return responses;
}

/** Light wrapper on type to wrap deserialize errors */
export function sszDeserializeResponse<T>(type: Type<T>, bytes: Uint8Array, opts?: {reuseBytes?: boolean}): T {
  try {
    return type.deserialize(bytes, opts);
  } catch (e) {
    throw new RequestError({code: RequestErrorCode.INVALID_RESPONSE_SSZ, errorMessage: (e as Error).message});
  }
}
