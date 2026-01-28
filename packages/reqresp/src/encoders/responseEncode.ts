import {Uint8ArrayList} from "uint8arraylist";
import {encodePayload} from "../encodingStrategies/index.js";
import {RespStatus, RpcResponseStatusError} from "../interface.js";
import {ContextBytesFactory, ContextBytesType, MixedProtocol, Protocol, ResponseOutgoing} from "../types.js";
import {encodeErrorMessage} from "../utils/index.js";

/**
 * Encodes a success response chunk to bytes ready for writing to stream.
 * Wire format:
 * ```bnf
 * response_chunk  ::= <result> | <context-bytes> | <varint-length> | <snappy-frames(ssz-payload)>
 * result          ::= "0"
 * ```
 */
export function encodeResponseChunk(protocol: Protocol, chunk: ResponseOutgoing): Uint8ArrayList {
  const result = new Uint8ArrayList();

  // <result> - success = 0
  result.append(new Uint8Array([RespStatus.SUCCESS]));

  // <context-bytes> - from altair (optional based on protocol)
  const contextBytes = getContextBytes(protocol.contextBytes, chunk);
  if (contextBytes) {
    result.append(contextBytes);
  }

  // <varint-length> | <snappy-frames(ssz-payload)>
  result.append(encodePayload(chunk.data, protocol.encoding));

  return result;
}

/**
 * Encodes an error response chunk to bytes ready for writing to stream.
 * Wire format:
 * ```bnf
 * error_response  ::= <result> | <error_message>?
 * result          ::= "1" | "2" | ["128" ... "255"]
 * ```
 * Only the last `<response_chunk>` is allowed to have a non-zero error code.
 */
export function encodeErrorResponse(
  protocol: Pick<MixedProtocol, "encoding">,
  status: RpcResponseStatusError,
  errorMessage: string
): Uint8ArrayList {
  const result = new Uint8ArrayList();

  // <result>
  result.append(new Uint8Array([status]));

  // <error_message>? is optional
  if (errorMessage) {
    result.append(encodeErrorMessage(errorMessage, protocol.encoding));
  }

  return result;
}

/**
 * Returns bytes for `<context-bytes>`. See `ContextBytesType` for possible types.
 * This item is mandatory but may be empty.
 */
function getContextBytes(contextBytes: ContextBytesFactory, chunk: ResponseOutgoing): Uint8Array | null {
  switch (contextBytes.type) {
    // Yield nothing
    case ContextBytesType.Empty:
      return null;

    // Yield a fixed-width 4 byte chunk, set to the `ForkDigest`
    case ContextBytesType.ForkDigest:
      return contextBytes.config.forkBoundary2ForkDigest(chunk.boundary);
  }
}
