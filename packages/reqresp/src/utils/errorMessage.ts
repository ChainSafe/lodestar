import {decode as varintDecode, encodingLength as varintEncodingLength} from "uint8-varint";
import {writeSszSnappyPayload} from "../encodingStrategies/sszSnappy/encode.js";
import {Encoding} from "../types.js";
import {decodeSnappyFrames} from "./snappyIndex.js";

// ErrorMessage schema:
//
// (
//   error_message: List[byte, 256]
// )
//
// By convention, the error_message is a sequence of bytes that MAY be interpreted as a
// UTF-8 string (for debugging purposes). Clients MUST treat as valid any byte sequences
//
// https://github.com/ethereum/consensus-specs/blob/v1.6.1/specs/phase0/p2p-interface.md#responding-side

/**
 * Encodes a UTF-8 string to 256 bytes max
 */
export function* encodeErrorMessage(errorMessage: string, encoding: Encoding): Generator<Buffer> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(errorMessage).slice(0, 256);

  switch (encoding) {
    case Encoding.SSZ_SNAPPY:
      yield* writeSszSnappyPayload(bytes);
      break;
    default:
      throw Error("Unsupported encoding");
  }
}

/**
 * Encodes a UTF-8 error message string into a single buffer (max 256 bytes before encoding).
 * Unlike `encodeErrorMessage`, this collects all encoded chunks into one buffer.
 */
export function encodeErrorMessageToBuffer(errorMessage: string, encoding: Encoding): Buffer {
  const chunks: Buffer[] = [];
  for (const chunk of encodeErrorMessage(errorMessage, encoding)) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Decodes error message from network bytes and removes non printable, non ascii characters.
 */
export function decodeErrorMessage(encodedErrorMessage: Uint8Array): string {
  const decoder = new TextDecoder();
  let sszDataLength: number;
  try {
    sszDataLength = varintDecode(encodedErrorMessage);
    const varintBytes = varintEncodingLength(sszDataLength);
    const errorMessage = decodeSnappyFrames(encodedErrorMessage.subarray(varintBytes));
    if (errorMessage.length !== sszDataLength) {
      throw new Error("Malformed input: data length mismatch");
    }
    // remove non ascii characters from string
    return decoder.decode(errorMessage.subarray(0)).replace(/[^\x20-\x7F]/g, "");
  } catch (_e) {
    // remove non ascii characters from string
    return decoder.decode(encodedErrorMessage.slice(0, 256)).replace(/[^\x20-\x7F]/g, "");
  }
}
