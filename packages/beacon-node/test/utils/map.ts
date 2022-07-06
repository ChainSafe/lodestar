/**
 * Util to compare ES6 Maps easily
 */
export function mapToObj<T>(map: Map<number | string, T>): {[key: string]: T} {
  return Array.from(map).reduce((obj: {[key: string]: T}, [key, value]) => {
    obj[key] = value;
    return obj;
  }, {});
}
