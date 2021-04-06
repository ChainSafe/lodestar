export function chunkify<T>(arr: T[], minPerChunk: number): T[][] {
  if (Math.floor(arr.length / minPerChunk) <= 1) {
    return [arr];
  }

  const arrArr: T[][] = [];

  for (let i = 0, j = arr.length; i < j; i += minPerChunk) {
    arrArr.push(arr.slice(i, i + minPerChunk));
  }

  return arrArr;
}
