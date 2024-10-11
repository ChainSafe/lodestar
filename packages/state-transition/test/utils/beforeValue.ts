import {beforeAll} from "vitest";

export type LazyValue<T> = {value: T};

/**
 * Register a callback to compute a value in the before() block of vitest tests
 * ```ts
 * const state = beforeValue(() => getState())
 * it("test", () => {
 *   doTest(state.value)
 * })
 * ```
 */
export function beforeValue<T>(fn: () => T | Promise<T>, timeout?: number): LazyValue<T> {
  let value: T = null as unknown as T;

  beforeAll(async function () {
    value = await fn();
  }, timeout ?? 300_000);

  return new Proxy<{value: T}>(
    {value},
    {
      get: function (_target, prop) {
        if (prop === "value") {
          if (value === null) {
            throw Error("beforeValue has not yet run the before() block");
          } else {
            return value;
          }
        } else {
          return undefined;
        }
      },
    }
  );
}
