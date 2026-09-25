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

/**
 * `process.hrtime()` in ms minus `performance.now()`, to express hrtime stamps, a worker's included, on the
 * `performance.now()` scale. `performance.now()` is read first since its first access can take about a millisecond, and
 * the offset comes from the tightest of several hrtime reads bracketed by `performance.now()`, taking the bracket's start
 * so converted times are never later than they happened.
 */
export function measureHrtimeOffsetMs(samples = 8): number {
  performance.now();
  let tightest = Number.POSITIVE_INFINITY;
  let offset = 0;
  for (let i = 0; i < samples; i++) {
    const before = performance.now();
    const [sec, ns] = process.hrtime();
    const after = performance.now();
    if (after - before < tightest) {
      tightest = after - before;
      offset = sec * 1000 + ns / 1e6 - before;
    }
  }
  return offset;
}
