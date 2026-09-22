/**
 * Randomize an array of items without mutation.
 * Note: Uses Math.random() as entropy source, use for non-critical stuff
 */
export function shuffle<T>(arr: T[]): T[] {
  const _arr: T[] = [...arr];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [_arr[i], _arr[j]] = [_arr[j], _arr[i]];
  }
  return _arr;
}
