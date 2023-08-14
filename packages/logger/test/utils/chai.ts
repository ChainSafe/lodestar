import {expect} from "chai";
import {Logger} from "../../src/interface.js";

export function expectDeepEquals<T>(a: T, b: T, message?: string): void {
  expect(a).deep.equals(b, message);
}

export function expectEquals<T>(a: T, b: T, message?: string): void {
  expect(a).equals(b, message);
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
      writer[key as keyof typeof writer] = function (data: string) {
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
