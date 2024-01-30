/**
 * Format a time in milliseconds to a string.
 * @param timeMs
 * @returns
 */
export function formatTime(timeMs: number): string {
  const d = new Date(timeMs);
  return `${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}.${d.getMilliseconds()}`;
}
