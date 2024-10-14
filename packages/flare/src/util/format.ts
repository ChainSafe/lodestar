/**
 * Parse string inclusive range: `0..32`, into an array of all values in that range
 */
export function parseRange(range: string): number[] {
  if (!range.includes("..")) {
    throw Error(`Invalid range '${range}', must include '..'`);
  }

  const [from, to] = range.split("..").map((n) => parseInt(n));

  if (Number.isNaN(from)) throw Error(`Invalid range from isNaN '${range}'`);
  if (Number.isNaN(to)) throw Error(`Invalid range to isNaN '${range}'`);
  if (from > to) throw Error(`Invalid range from > to '${range}'`);

  const arr: number[] = [];
  for (let i = from; i <= to; i++) {
    arr.push(i);
  }

  return arr;
}
