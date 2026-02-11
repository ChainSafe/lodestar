import type {Stream} from "@libp2p/interface";
import {byteStream} from "@libp2p/utils";
import {readEncodedPayload} from "../encodingStrategies/index.js";
import {MixedProtocol} from "../types.js";

const EMPTY_DATA = new Uint8Array();

/**
 * Consumes a stream source to read a `<request>`
 * ```bnf
 * request  ::= <encoding-dependent-header> | <encoded-payload>
 * ```
 */
export async function requestDecode(protocol: MixedProtocol, stream: Stream): Promise<Uint8Array> {
  const type = protocol.requestSizes;
  if (type === null) {
    // method has no body
    return EMPTY_DATA;
  }

  // Request has a single payload, so return immediately
  const bytes = byteStream(stream);
  try {
    return await readEncodedPayload(bytes, protocol.encoding, type);
  } finally {
    bytes.unwrap();
  }
}
