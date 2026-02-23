import type {Stream} from "@libp2p/interface";
import {byteStream} from "@libp2p/utils";
import {readEncodedPayload} from "../encodingStrategies/index.js";
import {MixedProtocol} from "../types.js";
import {drainByteStream} from "../utils/stream.ts";

const EMPTY_DATA = new Uint8Array();

/**
 * Consumes a stream source to read a `<request>`
 * ```bnf
 * request  ::= <encoding-dependent-header> | <encoded-payload>
 * ```
 */
export async function requestDecode(
  protocol: MixedProtocol,
  stream: Stream,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const type = protocol.requestSizes;
  if (type === null) {
    // method has no body
    return EMPTY_DATA;
  }

  // Request has a single payload, so return immediately
  const bytes = byteStream(stream);
  let requestReadDone = false;
  try {
    const requestBody = await readEncodedPayload(bytes, protocol.encoding, type, signal);
    requestReadDone = true;
    return requestBody;
  } finally {
    try {
      if (!requestReadDone) {
        // Do not push partial bytes back into the stream on decode failure/abort.
        // This stream is consumed by req/resp only once.
        drainByteStream(bytes);
      }
      bytes.unwrap();
    } catch {
      // Ignore unwrap errors - stream may already be closed
    }
  }
}
