import {
  merkleize as _merkleize,
  mixInLength as _mixInLength,
} from "./merkleize";

export function merkleize(chunks: Iterable<Uint8Array>, padTo: number): Uint8Array {
  return _merkleize(Array.from(chunks).map(Buffer.from), padTo);
}

export function mixInLength(root: Uint8Array, length: number): Uint8Array {
  return _mixInLength(Buffer.from(root), length);
}
