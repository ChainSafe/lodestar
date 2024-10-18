import {describe, it, expect, vi, afterEach, Mock} from "vitest";
import {LogLevel} from "@lodestar/utils";
import {TimestampFormatCode, logFormats} from "../../src/index.js";
import {getNodeLogger} from "../../src/node.js";
import {formatsTestCases} from "../fixtures/loggerFormats.js";

// Node.js maps `process.stdout` to `console._stdout`.
// spy does not work on `process.stdout` directly.
// biome-ignore lint/style/useNamingConvention: Need property name _stdout for testing
type TestConsole = typeof console & {_stdout: {write: Mock}};

describe("node logger", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("format and options", () => {
    for (const testCase of formatsTestCases) {
      const {id, opts, message, context, error, output} = typeof testCase === "function" ? testCase() : testCase;
      for (const format of logFormats) {
        it(`${id} ${format} output`, async () => {
          vi.spyOn((console as TestConsole)._stdout, "write");

          const logger = getNodeLogger({
            level: LogLevel.info,
            format,
            module: opts?.module,
            timestampFormat: {format: TimestampFormatCode.Hidden},
          });
          logger.warn(message, context, error);

          expect((console as TestConsole)._stdout.write).toHaveBeenNthCalledWith(1, `${output[format]}\n`);
        });
      }
    }
  });
});
