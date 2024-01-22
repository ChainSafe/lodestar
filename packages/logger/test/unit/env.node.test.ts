import {describe, it, expect} from "vitest";
import {LogLevel} from "@lodestar/utils";
import {stubLoggerForConsole} from "@lodestar/test-utils/doubles";
import {TimestampFormatCode, logFormats} from "../../src/index.js";
import {formatsTestCases} from "../fixtures/loggerFormats.js";
import {getEnvLogger} from "../../src/env.js";

describe("env logger", () => {
  describe("format and options", () => {
    for (const testCase of formatsTestCases) {
      const {id, opts, message, context, error, output} = typeof testCase === "function" ? testCase() : testCase;
      for (const format of logFormats) {
        it(`${id} ${format} output`, async () => {
          // Set env variables
          process.env.LOG_LEVEL = LogLevel.info;
          process.env.LOG_FORMAT = format;
          process.env.LOG_TIMESTAMP_FORMAT = TimestampFormatCode.Hidden;

          const logger = stubLoggerForConsole(getEnvLogger({module: opts?.module}));

          logger.warn(message, context, error);
          logger.restoreStubs();
          expect(logger.getLogs()).toEqual([output[format]]);
        });
      }
    }
  });
});
