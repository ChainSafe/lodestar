/**
 * Format a time in milliseconds to a string.
 * @param timeMs
 * @returns
 */
export function formatTime(timeMs: number): string {
  const date = new Date(0, 0, 0, 0, 0, 0, timeMs);
  return `${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}.${date.getMilliseconds()}`;
}
