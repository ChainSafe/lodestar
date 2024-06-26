// eslint-disable-next-line no-restricted-imports
import {Hasher, HashObject} from "@chainsafe/persistent-merkle-tree/lib/hasher/index.js";
import {byteArrayToHashObject} from "@chainsafe/as-sha256";
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
const hashInput = uint8Input.subarray(0, 64);
const hashOutput = uint8Output.subarray(0, 32);

export const hasher: Hasher = {
  digest64(obj1: Uint8Array, obj2: Uint8Array): Uint8Array {
    if (obj1.length !== 32 || obj2.length !== 32) {
      throw new Error("Invalid input length");
    }
    hashInput.set(obj1, 0);
    hashInput.set(obj2, 32);
    hashInto(hashInput, hashOutput);
    return hashOutput.slice();
  },
  digest64HashObjects(obj1: HashObject, obj2: HashObject): HashObject {
    hashObjectsToUint32Array(obj1, obj2, uint32Input);
    hashInto(hashInput, hashOutput);
    return byteArrayToHashObject(hashOutput);
  },
};

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
