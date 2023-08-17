import type {Suite} from "mocha";
import {Logger} from "@lodestar/utils";
import {TestContext} from "./interfaces.js";
export {TestContext} from "./interfaces.js";

/**
 * Create a Mocha context object that can be used to register callbacks that will be executed
 */
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

// Typescript does not support array of generics so have to use this flexible workaround
function wrapLogWriter(...writers: [writer: object, ...keys: string[]][]): {
  flush: () => string[];
  restore: () => void;
} {
  const cache = [] as string[];
  const originals: Record<number, Record<string, unknown>> = {};

  for (const [index, [writer, ...keys]] of writers.entries()) {
    originals[index] = {};

    for (const key of keys) {
      originals[index][key] = writer[key as keyof typeof writer];

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      writer[key as keyof typeof writer] = function mockedWriter(data: string) {
        // Our fixtures does not include the new line character
        cache.push(data.endsWith("\n") ? data.slice(0, -1) : data);
      };
    }
  }

  return {
    flush: () => cache,
    restore: () => {
      for (const [index, [writer, ...keys]] of writers.entries()) {
        for (const key of keys) {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-expect-error
          writer[key as keyof typeof writer] = originals[index][key];
        }
      }
    },
  };
}

export function stubLoggerForProcessStd<T extends Logger>(
  logger: T
): T & {getLogs: () => string[]; restoreStubs: () => void} {
  const {flush: flushStdout, restore: restoreStdout} = wrapLogWriter(
    [process.stdout, "write"],
    [process.stderr, "write"]
  );

  return Object.assign(logger, {
    getLogs: () => flushStdout(),
    restoreStubs: () => {
      restoreStdout();
    },
  });
}

export function stubLoggerForConsole<T extends Logger>(
  logger: T
): T & {getLogs: () => string[]; restoreStubs: () => void} {
  const {flush: flushConsole, restore: restoreConsole} = wrapLogWriter([
    console,
    "info",
    "warn",
    "error",
    "debug",
    "trace",
  ]);

  return Object.assign(logger, {
    getLogs: () => flushConsole(),
    restoreStubs: () => {
      restoreConsole();
    },
  });
}
