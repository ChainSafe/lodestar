export const logFilesDir = "test-logs";

/** Typesafe wrapper for string templating and handle multi-platform */
export function getLocalAddress(port: number): string {
  return `http://127.0.0.1:${port}`;
}
