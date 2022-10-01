export function avg(arr: number[]): number {
  let sum = 0;
  for (const value of arr) {
    sum += value;
  }
  return sum / arr.length;
}
