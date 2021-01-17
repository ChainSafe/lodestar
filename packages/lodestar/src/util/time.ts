/**
 * Render a time difference in human readable form
 */
export function prettyTimeDiff(diffMs: number): string {
  const secDiff = diffMs / 1000;
  const minDiff = secDiff / 60;
  const hourDiff = minDiff / 60;
  const daysDiff = hourDiff / 24;

  if (daysDiff > 1) return `${+daysDiff.toPrecision(2)} days`;
  if (hourDiff > 1) return `${+hourDiff.toPrecision(2)} hours`;
  if (minDiff > 1) return `${+minDiff.toPrecision(2)} minutes`;
  return `${+secDiff.toPrecision(2)} seconds`;
}
