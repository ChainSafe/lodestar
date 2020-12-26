// ErrorMessage schema:
//
// (
//   error_message: List[byte, 256]
// )
//
// By convention, the error_message is a sequence of bytes that MAY be interpreted as a
// UTF-8 string (for debugging purposes). Clients MUST treat as valid any byte sequences
//
// Spec v1.0.0 https://github.com/ethereum/eth2.0-specs/blob/v1.0.0-rc.0/specs/phase0/p2p-interface.md#responding-side

/**
 * Encodes a UTF-8 string to 256 bytes max
 */
export function encodeErrorMessage(errorMessage: string): Buffer {
  const encoder = new TextEncoder();
  return Buffer.from(encoder.encode(errorMessage).slice(0, 256));
}

/**
 * Decodes error message from network bytes and removes non printable, non ascii characters.
 */
export function decodeErrorMessage(errorMessage: Buffer): string {
  const encoder = new TextDecoder();
  // remove non ascii characters from string
  return encoder.decode(errorMessage.slice(0, 256)).replace(/[^\x20-\x7F]/g, "");
}
