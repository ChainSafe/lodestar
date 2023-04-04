export type LazyValue<T> = {value: T};

/**
 * Register a callback to compute a value in the before() block of mocha tests
 * ```ts
 * const state = beforeValue(() => getState())
 * it("test", () => {
 *   doTest(state.value)
 * })
 * ```
 */
export function beforeValue<T>(fn: () => T | Promise<T>, timeout?: number): LazyValue<T> {
  let value: T = null as unknown as T;

  before(async function () {
    this.timeout(timeout ?? 300_000);
    value = await fn();
  });

  return new Proxy<{value: T}>(
    {value},
    {
      get: function (target, prop) {
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
