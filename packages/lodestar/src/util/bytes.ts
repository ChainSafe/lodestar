import {Root} from "@chainsafe/lodestar-types";

export function byteArrayConcat(bytesArr: Uint8Array[]): Uint8Array {
  const totalBytes = bytesArr.reduce((total, bytes) => total + bytes.length, 0);
  const mergedBytes = new Uint8Array(totalBytes);

  let offset = 0;
  for (const bytes of bytesArr) {
    mergedBytes.set(bytes, offset);
    offset += bytes.length;
  }

  return mergedBytes;
}

export function byteArrayEquals(a: Uint8Array | Root, b: Uint8Array | Root): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
