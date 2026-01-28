import type {MessageStream} from "@libp2p/interface";
import type {ByteStream} from "@libp2p/utils";
import {decodePayload} from "../encodingStrategies/index.js";
import {MixedProtocol} from "../types.js";

const EMPTY_DATA = new Uint8Array();

/**
 * Reads and decodes a request from a stream using byteStream.
 * Wire format:
 * ```bnf
 * request  ::= <varint-length> | <snappy-frames(ssz-payload)>
 * ```
 * Returns empty Uint8Array if protocol has no request body.
 */
export async function decodeRequest(
  bytes: ByteStream<MessageStream>,
  protocol: MixedProtocol,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const type = protocol.requestSizes;
  if (type === null) {
    // method has no body
    return EMPTY_DATA;
  }

  // Request has a single payload
  return decodePayload(bytes, protocol.encoding, type, signal);
}
