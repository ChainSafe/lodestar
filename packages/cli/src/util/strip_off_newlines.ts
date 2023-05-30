/**
 * Remove trailing new lines '\n' or '\r' if any
 */
export function stripOffNewlines(s: string): string {
  return s.replace(/[\n\r]+$/g, "");
}
