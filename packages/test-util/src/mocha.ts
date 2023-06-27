import type {Suite} from "mocha";
import {TestContext} from "./interfaces.js";
export {TestContext} from "./interfaces.js";

export function getMochaContext(suite: Suite): TestContext {
  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  const beforeEachCallbacks: (() => Promise<void> | void)[] = [];
  const afterAllCallbacks: (() => Promise<void> | void)[] = [];

  const context: TestContext = {
    afterEach: (cb) => afterEachCallbacks.push(cb),
    beforeEach: (cb) => beforeEachCallbacks.push(cb),
    afterAll: (cb) => afterAllCallbacks.push(cb),
  };

  const callbacks = [afterEachCallbacks, beforeEachCallbacks, afterAllCallbacks];
  const hooks = [suite.afterEach, suite.beforeEach, suite.afterAll];

  for (const [index, cbs] of callbacks.entries()) {
    const hook = hooks[index].bind(suite);

    hook(async function mochaHook() {
      // Add increased timeout for that hook
      this.timeout(10000);

      const errs: Error[] = [];
      for (const cb of cbs) {
        try {
          await cb();
        } catch (e) {
          errs.push(e as Error);
        }
      }
      cbs.length = 0; // Reset array
      if (errs.length > 0) {
        throw errs[0];
      }
    });
  }

  return context;
}
