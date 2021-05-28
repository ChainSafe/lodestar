import qs from "qs";

/**
 * Eth2.0 API requires the query with format:
 * - arrayFormat: repeat `topic=topic1&topic=topic2`
 */
export function stringifyQuery(query: unknown): string {
  return qs.stringify(query, {arrayFormat: "repeat"});
}

/**
 * TODO: Optimize, two regex is a bit wasteful
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
