export function bufferToHex(buffer: Buffer): string {
  return "0x" + buffer.toString("hex");
}

export function hexToBuffer(v: string): Buffer {
  return Buffer.from(v.replace("0x", ""));
}