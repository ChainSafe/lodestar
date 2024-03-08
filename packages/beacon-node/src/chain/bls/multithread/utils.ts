import crypto from "node:crypto";

/**
 * Splits an array into an array of arrays maximizing the size of the smallest chunk.
 */
export function chunkifyMaximizeChunkSize<T>(arr: T[], minPerChunk: number): T[][] {
  const chunkCount = Math.floor(arr.length / minPerChunk);
  if (chunkCount <= 1) {
    return [arr];
  }

  // Prefer less chunks of bigger size
  const perChunk = Math.ceil(arr.length / chunkCount);
  const arrArr: T[][] = [];

  for (let i = 0; i < arr.length; i += perChunk) {
    arrArr.push(arr.slice(i, i + perChunk));
  }

  return arrArr;
}

/**
 * `rand` must not be exactly zero. Otherwise it would allow the verification of invalid signatures
 * See https://github.com/ChainSafe/blst-ts/issues/45
 */
export function randomBytesNonZero(bytesCount: number): Buffer {
  const rand = crypto.randomBytes(bytesCount);
  for (let i = 0; i < bytesCount; i++) {
    if (rand[i] !== 0) return rand;
  }
  rand[0] = 1;
  return rand;
}
