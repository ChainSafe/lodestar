import {byteArrayIntoHashObject} from "@chainsafe/as-sha256";
import {
  HashComputationLevel,
  HashObject,
  Hasher,
  Node,
  doDigestNLevel,
  doMerkleizeBlockArray,
  doMerkleizeBlocksBytes,
} from "@chainsafe/persistent-merkle-tree";
import {digest2Bytes32, digest2Bytes32Into, hashInto} from "@lodestar/bun";

/**
 * Best SIMD implementation is in 512 bits = 64 bytes
 * If not, hashtree will make a loop inside
 * Given sha256 operates on a block of 4 bytes, we can hash 16 inputs at once
 * Each input is 64 bytes
 */
const PARALLEL_FACTOR = 16;
const MAX_INPUT_SIZE = PARALLEL_FACTOR * 64;
const uint8Input = new Uint8Array(MAX_INPUT_SIZE);
const uint32Input = new Uint32Array(uint8Input.buffer);
const uint8Output = new Uint8Array(PARALLEL_FACTOR * 32);
// having this will cause more memory to extract uint32
// const uint32Output = new Uint32Array(uint8Output.buffer);
// convenient reusable Uint8Array for hash64
const hash64Input = uint8Input.subarray(0, 64);
const hash64Output = uint8Output.subarray(0, 32);
// size input array to 2 HashObject per computation * 32 bytes per object
const destNodes: Node[] = new Array<Node>(PARALLEL_FACTOR);

export const hasher: Hasher = {
  name: "hashtree-bun",
  hashInto,
  digest64(obj1: Uint8Array, obj2: Uint8Array): Uint8Array {
    return digest2Bytes32(obj1, obj2);
  },
  digest64Into: (obj1: Uint8Array, obj2: Uint8Array, output: Uint8Array): void => {
    digest2Bytes32Into(obj1, obj2, output);
  },
  digest64HashObjects(left: HashObject, right: HashObject, parent: HashObject): void {
    hashObjectsToUint32Array(left, right, uint32Input);
    hashInto(hash64Input, hash64Output);
    byteArrayIntoHashObject(hash64Output, 0, parent);
  },
  merkleizeBlocksBytes(blocksBytes: Uint8Array, padFor: number, output: Uint8Array, offset: number): void {
    doMerkleizeBlocksBytes(blocksBytes, padFor, output, offset, hashInto);
  },
  merkleizeBlockArray(blocks, blockLimit, padFor, output, offset) {
    doMerkleizeBlockArray(blocks, blockLimit, padFor, output, offset, hashInto, uint8Input);
  },
  digestNLevel(data: Uint8Array, nLevel: number): Uint8Array {
    return doDigestNLevel(data, nLevel, hashInto);
  },
  executeHashComputations(hashComputations: HashComputationLevel[]): void {
    for (let level = hashComputations.length - 1; level >= 0; level--) {
      const hcArr = hashComputations[level];
      if (!hcArr) {
        // should not happen
        throw Error(`no hash computations for level ${level}`);
      }

      if (hcArr.length === 0) {
        // nothing to hash
        continue;
      }

      // hash every 16 inputs at once to avoid memory allocation
      let i = 0;
      for (const {src0, src1, dest} of hcArr) {
        if (!src0 || !src1 || !dest) {
          throw new Error(`Invalid HashComputation at index ${i}`);
        }
        const indexInBatch = i % PARALLEL_FACTOR;
        const offset = indexInBatch * 16;

        hashObjectToUint32Array(src0, uint32Input, offset);
        hashObjectToUint32Array(src1, uint32Input, offset + 8);
        destNodes[indexInBatch] = dest;
        if (indexInBatch === PARALLEL_FACTOR - 1) {
          hashInto(uint8Input, uint8Output);
          for (const [j, destNode] of destNodes.entries()) {
            byteArrayIntoHashObject(uint8Output, j * 32, destNode);
          }
        }
        i++;
      }

      const remaining = hcArr.length % PARALLEL_FACTOR;
      // we prepared data in input, now hash the remaining
      if (remaining > 0) {
        const remainingInput = uint8Input.subarray(0, remaining * 64);
        const remainingOutput = uint8Output.subarray(0, remaining * 32);
        hashInto(remainingInput, remainingOutput);
        // destNodes was prepared above
        for (let j = 0; j < remaining; j++) {
          byteArrayIntoHashObject(remainingOutput, j * 32, destNodes[j]);
        }
      }
    }
  },
};

function hashObjectToUint32Array(obj: HashObject, arr: Uint32Array, offset: number): void {
  arr[offset] = obj.h0;
  arr[offset + 1] = obj.h1;
  arr[offset + 2] = obj.h2;
  arr[offset + 3] = obj.h3;
  arr[offset + 4] = obj.h4;
  arr[offset + 5] = obj.h5;
  arr[offset + 6] = obj.h6;
  arr[offset + 7] = obj.h7;
}

// note that uint32ArrayToHashObject will cause more memory
function hashObjectsToUint32Array(obj1: HashObject, obj2: HashObject, arr: Uint32Array): void {
  arr[0] = obj1.h0;
  arr[1] = obj1.h1;
  arr[2] = obj1.h2;
  arr[3] = obj1.h3;
  arr[4] = obj1.h4;
  arr[5] = obj1.h5;
  arr[6] = obj1.h6;
  arr[7] = obj1.h7;
  arr[8] = obj2.h0;
  arr[9] = obj2.h1;
  arr[10] = obj2.h2;
  arr[11] = obj2.h3;
  arr[12] = obj2.h4;
  arr[13] = obj2.h5;
  arr[14] = obj2.h6;
  arr[15] = obj2.h7;
}
