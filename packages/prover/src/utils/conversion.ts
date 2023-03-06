export function numberToHex(n: number | bigint): string {
  return "0x" + n.toString(16);
}

export function hexToNumber(n: string): number {
  return n.startsWith("0x") ? parseInt(n.slice(2), 16) : parseInt(n, 16);
}

export function bufferToHex(buffer: Buffer | Uint8Array): string {
  return "0x" + Buffer.from(buffer).toString("hex");
}

export function hexToBuffer(v: string): Buffer {
  return Buffer.from(v.replace("0x", ""), "hex");
}

export function padLeft(v: Uint8Array, length: number): Uint8Array {
  const buf = Buffer.alloc(length);
  Buffer.from(v).copy(buf, length - v.length);
  return buf;
}
