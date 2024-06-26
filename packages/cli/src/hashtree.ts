// eslint-disable-next-line no-restricted-imports
import {Hasher, HashObject} from "@chainsafe/persistent-merkle-tree/lib/hasher/index.js";
import {hashInto} from "@chainsafe/hashtree";

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
const uint32Output = new Uint32Array(uint8Output.buffer);

export const hasher: Hasher = {
  digest64(obj1: Uint8Array, obj2: Uint8Array): Uint8Array {
    if (obj1.length !== 32 || obj2.length !== 32) {
      throw new Error("Invalid input length");
    }
    uint8Input.set(obj1, 0);
    uint8Input.set(obj2, 32);
    const hashInput = uint8Input.subarray(0, 64);
    const hashOutput = uint8Output.subarray(0, 32);
    hashInto(hashInput, hashOutput);
    return hashOutput.slice();
  },
  digest64HashObjects(obj1: HashObject, obj2: HashObject): HashObject {
    hashObjectToUint32Array(obj1, uint32Input, 0);
    hashObjectToUint32Array(obj2, uint32Input, 8);
    const hashInput = uint8Input.subarray(0, 64);
    const hashOutput = uint8Output.subarray(0, 32);
    hashInto(hashInput, hashOutput);
    return uint32ArrayToHashObject(uint32Output, 0);
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

function uint32ArrayToHashObject(arr: Uint32Array, offset: number): HashObject {
  return {
    h0: arr[offset],
    h1: arr[offset + 1],
    h2: arr[offset + 2],
    h3: arr[offset + 3],
    h4: arr[offset + 4],
    h5: arr[offset + 5],
    h6: arr[offset + 6],
    h7: arr[offset + 7],
  };
}
