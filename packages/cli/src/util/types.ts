/**
 * Typed `Object.keys(o: T)` function, returning `(keyof T)[]`
 */

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
export function ObjectKeys<T extends {[key: string]: any}>(o: T): (keyof T)[] {
  return Object.keys(o);
}
