import {writeEncodedPayload} from "../encodingStrategies/index.js";
import {encodeErrorMessage} from "../utils/index.js";
import {ContextBytesType, ContextBytesFactory, MixedProtocol, Protocol, ResponseOutgoing} from "../types.js";
import {RespStatus, RpcResponseStatusError} from "../interface.js";

/**
 * Yields byte chunks for a `<response>` with a zero response code `<result>`
 * ```bnf
 * response        ::= <response_chunk>*
 * response_chunk  ::= <result> | <context-bytes> | <encoding-dependent-header> | <encoded-payload>
 * result          ::= "0"
 * ```
 * Note: `response` has zero or more chunks (denoted by `<>*`)
 */
export function responseEncodeSuccess(
  protocol: Protocol,
  cbs: {onChunk: (chunkIndex: number) => void}
): (source: AsyncIterable<ResponseOutgoing>) => AsyncIterable<Buffer> {
  return async function* responseEncodeSuccessTransform(source) {
    let chunkIndex = 0;

    for await (const chunk of source) {
      // Postfix increment, return 0 as first chunk
      cbs.onChunk(chunkIndex++);

      // <result>
      yield Buffer.from([RespStatus.SUCCESS]);

      // <context-bytes> - from altair
      const contextBytes = getContextBytes(protocol.contextBytes, chunk);
      if (contextBytes) {
        yield contextBytes as Buffer;
      }

      // <encoding-dependent-header> | <encoded-payload>
      yield* writeEncodedPayload(chunk.data, protocol.encoding);
    }
  };
}

/**
 * Yields byte chunks for a `<response_chunk>` with a non-zero response code `<result>`
 * denoted as `<error_response>`
 * ```bnf
 * error_response  ::= <result> | <error_message>?
 * result          ::= "1" | "2" | ["128" ... "255"]
 * ```
 * Only the last `<response_chunk>` is allowed to have a non-zero error code, so this
 * fn yields exactly one `<error_response>` and afterwards the stream must be terminated
 */
export async function* responseEncodeError(
  protocol: Pick<MixedProtocol, "encoding">,
  status: RpcResponseStatusError,
  errorMessage: string
): AsyncGenerator<Buffer> {
  // <result>
  yield Buffer.from([status]);

  // <error_message>? is optional
  if (errorMessage) {
    yield* encodeErrorMessage(errorMessage, protocol.encoding);
  }
}

/**
 * Yields byte chunks for a `<context-bytes>`. See `ContextBytesType` for possible types.
 * This item is mandatory but may be empty.
 */
function getContextBytes(contextBytes: ContextBytesFactory, chunk: ResponseOutgoing): Uint8Array | null {
  switch (contextBytes.type) {
    // Yield nothing
    case ContextBytesType.Empty:
      return null;

    // Yield a fixed-width 4 byte chunk, set to the `ForkDigest`
    case ContextBytesType.ForkDigest:
      return contextBytes.forkDigestContext.forkName2ForkDigest(chunk.fork) as Buffer;
  }
}
