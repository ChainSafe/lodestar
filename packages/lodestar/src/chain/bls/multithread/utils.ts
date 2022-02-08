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
 * Cross-platform fetch an aprox number of logical cores
 */
export function getDefaultPoolSize(): number {
  if (typeof navigator !== "undefined") {
    return navigator.hardwareConcurrency ?? 4;
  }

  if (typeof require !== "undefined") {
    // eslint-disable-next-line
    return require("node:os").cpus().length;
  }

  return 8;
}
