/**
 * Joins multiple url parts safely
 * - Does not break the protocol double slash //
 * - Cleans double slashes at any point
 * @param args ("http://localhost/", "/node/", "/genesis_time")
 * @return "http://localhost/node/genesis_time"
 */
export function urlJoin(...args: string[]): string {
  return (
    args
      .join("/")
      .replace(/([^:]\/)\/+/g, "$1")
      // Remove duplicate slashes in the front
      .replace(/^(\/)+/, "/")
  );
}
