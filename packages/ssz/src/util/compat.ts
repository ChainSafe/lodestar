import {
  hash as _hash,
} from "./hash";
import {
  merkleize as _merkleize,
  mixInLength as _mixInLength,
} from "./merkleize";

export function hash(...inputs: Uint8Array[]): Uint8Array {
  return Uint8Array.from(_hash(...inputs.map(Buffer.from)));
}

export function merkleize(chunks: Iterable<Uint8Array>, padTo: number): Uint8Array {
  return _merkleize(Array.from(chunks).map(Buffer.from), padTo);
}

export function mixInLength(root: Uint8Array, length: number): Uint8Array {
  return _mixInLength(Buffer.from(root), length);
}
