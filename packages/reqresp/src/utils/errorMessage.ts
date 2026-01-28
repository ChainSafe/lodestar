import {decode as varintDecode, encodingLength as varintEncodingLength} from "uint8-varint";
import {Uint8ArrayList} from "uint8arraylist";
import {encodeSszSnappyPayload} from "../encodingStrategies/sszSnappy/encode.js";
import {Encoding} from "../types.js";
import {SnappyFramesUncompress} from "./snappyIndex.js";

// ErrorMessage schema:
//
// (
//   error_message: List[byte, 256]
// )
//
// By convention, the error_message is a sequence of bytes that MAY be interpreted as a
// UTF-8 string (for debugging purposes). Clients MUST treat as valid any byte sequences
//
// Spec v1.1.10 https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#responding-side

/**
 * Encodes a UTF-8 string to 256 bytes max with SSZ-snappy encoding.
 * Returns Uint8ArrayList ready for writing to stream.
 */
export function encodeErrorMessage(errorMessage: string, encoding: Encoding): Uint8ArrayList {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(errorMessage).slice(0, 256);

  switch (encoding) {
    case Encoding.SSZ_SNAPPY:
      return encodeSszSnappyPayload(bytes);
    default:
      throw new Error(`Unsupported encoding: ${encoding}`);
  }
}

/**
 * Decodes error message from network bytes and removes non printable, non ascii characters.
 */
export function decodeErrorMessage(encodedErrorMessage: Uint8Array): string {
  const decoder = new TextDecoder();
  let sszDataLength: number;
  try {
    sszDataLength = varintDecode(encodedErrorMessage);
    const decompressor = new SnappyFramesUncompress();
    const varintBytes = varintEncodingLength(sszDataLength);
    const errorMessage = decompressor.uncompress(new Uint8ArrayList(encodedErrorMessage.subarray(varintBytes)));
    if (errorMessage == null || errorMessage.length !== sszDataLength) {
      throw new Error("Malformed input: data length mismatch");
    }
    // remove non ascii characters from string
    return decoder.decode(errorMessage.subarray(0)).replace(/[^\x20-\x7F]/g, "");
  } catch (_e) {
    // remove non ascii characters from string
    return decoder.decode(encodedErrorMessage.slice(0, 256)).replace(/[^\x20-\x7F]/g, "");
  }
}
