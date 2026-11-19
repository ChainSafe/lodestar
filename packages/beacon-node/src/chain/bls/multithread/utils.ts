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
 * Splits an array into chunks that do not exceed a maximum size.
 */
export function chunkifyMaxChunkSize<T>(arr: T[], maxPerChunk: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += maxPerChunk) {
    chunks.push(arr.slice(i, i + maxPerChunk));
  }
  return chunks;
}
