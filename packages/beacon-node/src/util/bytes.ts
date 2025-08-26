import {Root} from "@lodestar/types";

export function byteArrayEquals(a: Uint8Array | Root, b: Uint8Array | Root): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function byteArrayArrayEquals(arrA: Uint8Array[], arrB: Uint8Array[]): boolean {
  if (arrA.length !== arrB.length) return false;

  for (let i = 0; i < arrA.length; i++) {
    if (!byteArrayEquals(arrA[i], arrB[i])) {
      return false;
    }
  }
  return true;
}
