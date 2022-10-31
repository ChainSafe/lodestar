import {encodeSszSnappy} from "../encodingStrategies/sszSnappy/encode.js";
import {Encoding} from "../types.js";

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
 * Encodes a UTF-8 string to 256 bytes max
 */
export async function* encodeErrorMessage(errorMessage: string, encoding: Encoding): AsyncGenerator<Buffer> {
  const encoder = new TextEncoder();
  const bytes = Buffer.from(encoder.encode(errorMessage).slice(0, 256));

  switch (encoding) {
    case Encoding.SSZ_SNAPPY:
      yield* encodeSszSnappy(bytes);
  }
}

/**
 * Decodes error message from network bytes and removes non printable, non ascii characters.
 */
export function decodeErrorMessage(errorMessage: Uint8Array): string {
  const encoder = new TextDecoder();
  // remove non ascii characters from string
  return encoder.decode(errorMessage.slice(0, 256)).replace(/[^\x20-\x7F]/g, "");
}
