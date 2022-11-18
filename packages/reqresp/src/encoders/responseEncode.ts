import {ForkName} from "@lodestar/params";
import {writeEncodedPayload} from "../encodingStrategies/index.js";
import {encodeErrorMessage} from "../utils/index.js";
import {
  ContextBytesType,
  ContextBytesFactory,
  ProtocolDefinition,
  EncodedPayload,
  EncodedPayloadType,
} from "../types.js";
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
export function responseEncodeSuccess<Req, Resp>(
  protocol: ProtocolDefinition<Req, Resp>
): (source: AsyncIterable<EncodedPayload<Resp>>) => AsyncIterable<Buffer> {
  return async function* responseEncodeSuccessTransform(source) {
    for await (const chunk of source) {
      // <result>
      yield Buffer.from([RespStatus.SUCCESS]);

      // <context-bytes> - from altair
      const contextBytes = getContextBytes<Resp>(protocol.contextBytes, chunk);
      if (contextBytes) {
        yield contextBytes as Buffer;
      }

      // <encoding-dependent-header> | <encoded-payload>
      const forkName = getForkNameFromContextBytes(protocol.contextBytes, chunk);
      const respType = protocol.responseType(forkName);
      yield* writeEncodedPayload(chunk, protocol.encoding, respType);
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
  protocol: Pick<ProtocolDefinition, "encoding">,
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
function getContextBytes<Resp>(
  contextBytes: ContextBytesFactory<Resp>,
  chunk: EncodedPayload<Resp>
): Uint8Array | null {
  switch (contextBytes.type) {
    // Yield nothing
    case ContextBytesType.Empty:
      return null;

    // Yield a fixed-width 4 byte chunk, set to the `ForkDigest`
    case ContextBytesType.ForkDigest:
      switch (chunk.type) {
        case EncodedPayloadType.ssz:
          return contextBytes.forkDigestContext.forkName2ForkDigest(
            contextBytes.forkFromResponse(chunk.data)
          ) as Buffer;

        case EncodedPayloadType.bytes:
          if (chunk.contextBytes.type !== ContextBytesType.ForkDigest) {
            throw Error(`Expected context bytes ForkDigest but got ${chunk.contextBytes.type}`);
          }
          return contextBytes.forkDigestContext.forkName2ForkDigest(
            contextBytes.forkDigestContext.getForkName(chunk.contextBytes.forkSlot)
          ) as Buffer;
      }
  }
}

function getForkNameFromContextBytes<Resp>(
  contextBytes: ContextBytesFactory<Resp>,
  chunk: EncodedPayload<Resp>
): ForkName {
  switch (contextBytes.type) {
    case ContextBytesType.Empty:
      return ForkName.phase0;

    // Yield a fixed-width 4 byte chunk, set to the `ForkDigest`
    case ContextBytesType.ForkDigest:
      switch (chunk.type) {
        case EncodedPayloadType.ssz:
          return contextBytes.forkFromResponse(chunk.data);

        case EncodedPayloadType.bytes:
          if (chunk.contextBytes.type !== ContextBytesType.ForkDigest) {
            throw Error(`Expected context bytes ForkDigest but got ${chunk.contextBytes.type}`);
          }
          return contextBytes.forkDigestContext.getForkName(chunk.contextBytes.forkSlot);
      }
  }
}
