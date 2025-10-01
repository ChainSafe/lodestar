/**
 * Typed `Object.keys(o: T)` function, returning `(keyof T)[]`
 */

// biome-ignore lint/suspicious/noExplicitAny: We need to use `any` type here
export function ObjectKeys<T extends {[key: string]: any}>(o: T): (keyof T)[] {
  return Object.keys(o);
}
