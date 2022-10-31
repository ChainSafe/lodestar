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
