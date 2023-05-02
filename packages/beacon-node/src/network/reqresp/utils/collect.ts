import {ResponseIncoming, RequestErrorCode, RequestError, ProtocolDescriptor} from "@lodestar/reqresp";
import {Type} from "@chainsafe/ssz";

/**
 * Sink for `<response_chunk>*`, from
 * ```bnf
 * response ::= <response_chunk>*
 * ```
 * Expects exactly one response
 */
export async function collectExactOneTyped<T>(
  protocol: ProtocolDescriptor,
  source: AsyncIterable<ResponseIncoming>
): Promise<T> {
  for await (const chunk of source) {
    const type = protocol.responseEncoder(chunk.fork);
    const response = sszDeserializeResponse(type, chunk.data) as T;
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
  protocol: ProtocolDescriptor,
  source: AsyncIterable<ResponseIncoming>,
  maxResponses: number
): Promise<T[]> {
  // else: zero or more responses
  const responses: T[] = [];
  for await (const chunk of source) {
    const type = protocol.responseEncoder(chunk.fork);
    const response = sszDeserializeResponse(type, chunk.data) as T;
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
