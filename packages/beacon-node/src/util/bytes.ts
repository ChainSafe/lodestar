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

export function byteArrayEqualsThrowBadIndexes(a: Uint8Array | Root, b: Uint8Array | Root): boolean {
  if (a.length !== b.length) {
    throw new Error(`byteArrayEquals: length mismatch: ${a.length} !== ${b.length}`);
  }
  const invalidBytes: number[] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) invalidBytes.push(i);
  }
  if (invalidBytes.length > 0) {
    throw new Error(`byteArrayEquals: mismatch at indexes ${invalidBytes.join(", ")}`);
  }
  return true;
}
