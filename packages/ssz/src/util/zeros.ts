/** @module ssz */
import {BYTES_PER_CHUNK} from "./constants";
import {hash} from "./hash";

// create array of "zero hashes", successively hashed zero chunks
export const zeroHashes = [Buffer.alloc(BYTES_PER_CHUNK)];
for (let i = 0; i < 52; i++) {
  zeroHashes.push(hash(zeroHashes[i], zeroHashes[i]));
}
