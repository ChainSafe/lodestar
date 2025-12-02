/**
 * Given an enum
 * ```ts
 * enum A {
 *   a = "a",
 *   b = "b"
 * }
 * ```
 * returns
 * ```ts
 * { a: 0,
 *   b: 1 }
 * ```
 */
export function enumToIndexMap<T>(enumVar: T): Record<keyof T, number> {
  return Object.fromEntries(Object.keys(enumVar as object).map((key, i) => [key, i])) as Record<keyof T, number>;
}
