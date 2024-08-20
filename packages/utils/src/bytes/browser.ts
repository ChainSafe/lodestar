const hexByByte: string[] = [];
export function toHexString(bytes: Uint8Array): string {
  let hex = "0x";
  for (const byte of bytes) {
    if (!hexByByte[byte]) {
      hexByByte[byte] = byte < 16 ? "0" + byte.toString(16) : byte.toString(16);
    }
    hex += hexByByte[byte];
  }
  return hex;
}
