/** @module ssz */
import {hash} from "./hash";
import {nextPowerOf2, bitLength} from "./math";
import {zeroHashes} from "./zeros";

export function pushHash(hashes: Uint8Array[], h: Uint8Array, i: number): void {
  let curHash = h;
  while (hashes[i]) {
    curHash = hash(Buffer.from(hashes[i]), Buffer.from(curHash));
    delete hashes[i];
    i++;
  }
  hashes[i] = curHash;
}

/** @ignore */
export function merkleize(chunks: Iterable<Uint8Array>, padFor: number): Buffer {
  const layerCount = bitLength(nextPowerOf2(padFor) - 1);
  const hashes: Uint8Array[] = Array.from({length: layerCount});
  for (const chunk of chunks) {
    pushHash(hashes, chunk, 0);
  }
  for (let i = 0; i < layerCount - 1; i++) {
    if (hashes[i]) {
      pushHash(hashes, zeroHashes[i], i);
    }
  }
  return hashes[layerCount - 1] as Buffer;
}

/** @ignore */
export function mixInLength(root: Buffer, length: number): Buffer {
  const lengthBuf = Buffer.alloc(32);
  lengthBuf.writeUIntLE(length, 0, 6);
  return hash(root, lengthBuf) as Buffer;
}
