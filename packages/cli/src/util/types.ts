/**
 * Typed `Object.keys(o: T)` function, returning `(keyof T)[]`
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/naming-convention
export function ObjectKeys<T extends {[key: string]: any}>(o: T): (keyof T)[] {
  return Object.keys(o);
}
