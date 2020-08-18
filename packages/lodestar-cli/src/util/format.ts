/**
 * 0x prefix a string if not prefixed already
 */
export function add0xPrefix(hex: string): string {
  if (!hex.startsWith("0x")) {
    return `0x${hex}`;
  } else {
    return hex;
  }
}
