/**
 * Assert condition is truthy, otherwise throw AssertionError
 * @param condition 
 * @param message 
 */
export function assert(condition: boolean, message?: string): void {
  if (!condition) {
    throw new AssertionError(message || "Expect false == true");
  }
}

export class AssertionError extends Error {
  static code = "ERR_ASSERTION";
}