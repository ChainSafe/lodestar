// eslint-disable-next-line import/no-extraneous-dependencies, @typescript-eslint/no-unused-vars
import * as vitest from "vitest";

interface CustomMatchers<R = unknown> {
  toBeValidEpochCommittee(opts: {committeeCount: number; validatorsPerCommittee: number; slotsPerEpoch: number}): R;
  /**
   * @deprecated
   * We highly recommend to not use this matcher instead use detail test case
   * where you don't need message to explain assertion
   *
   * @example
   * ```ts
   * it("should work as expected", () => {
   *   const a = 1;
   *   const b = 2;
   *   expect(a).toBeWithMessage(b, "a must be equal to b");
   * });
   * ```
   * can be written as:
   * ```ts
   * it("a should always same as b", () => {
   *   const a = 1;
   *   const b = 2;
   *   expect(a).toBe(b);
   * });
   * ```
   * */
  toBeWithMessage(expected: unknown, message: string): R;
}

interface CustomAsymmetricMatchers<R = unknown> extends CustomMatchers<R> {
  /**
   * Non-asymmetric matcher already exists, we just need to add asymmetric version
   */
  toSatisfy(func: (received: unknown) => boolean): R;
}

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Assertion<T = any> extends CustomMatchers<T> {}
  interface AsymmetricMatchersContaining extends CustomAsymmetricMatchers {}
}
