/**
 * Converts non-camelcase to camelcase
 * "one_two" => "oneTwo"
 * @param str 
 */
export function camelcase(str: string): string {
  return str
    .replace(/^[_.\- ]+/, "")
    .toLocaleLowerCase()
    .replace(/[_.\- ]+([\p{Alpha}\p{N}_]|$)/gu, (_, p1) => p1.toLocaleUpperCase())
    .replace(/\d+([\p{Alpha}\p{N}_]|$)/gu, m => m.toLocaleUpperCase());
}
