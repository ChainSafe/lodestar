/**
 * Returns num evenly spaced samples, calculated over the interval [start, stop] inclusive.
 */
export function linspace(start: number, stop: number): number[] {
  const arr: number[] = [];
  for (let i = start; i <= stop; i++) arr.push(i);
  return arr;
}
