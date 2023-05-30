/**
 * Type-safe helper to filter out nullist values from an array
 * ```js
 * const array: (string | null)[] = ['foo', null];
 * const filteredArray: string[] = array.filter(notEmpty);
 * ```
 * @param value
 */
export function notNullish<TValue>(value: TValue | null | undefined): value is TValue {
  return value !== null && value !== undefined;
}
