import {vi, MockInstance} from "vitest";
import {Logger} from "@lodestar/utils";

type Callback = () => void;
type Handler = (cb: Callback) => void;

/**
 * Stub the logger methods
 */
export function stubLogger(context: {beforeEach: Handler; afterEach: Handler}, logger = console): void {
  context.beforeEach(() => {
    vi.spyOn(logger, "info");
    vi.spyOn(logger, "log");
    vi.spyOn(logger, "warn");
    vi.spyOn(logger, "error");
  });

  context.afterEach(() => {
    (logger.info as unknown as MockInstance).mockRestore();
    (logger.log as unknown as MockInstance).mockRestore();
    (logger.warn as unknown as MockInstance).mockRestore();
    (logger.error as unknown as MockInstance).mockRestore();
  });
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
          // @ts-expect-error
          writer[key as keyof typeof writer] = originals[index][key];
        }
      }
    },
  };
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
