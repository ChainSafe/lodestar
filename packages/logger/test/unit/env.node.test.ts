import {expect} from "chai";
import {LogLevel} from "@lodestar/utils";
import {stubLoggerForConsole} from "@lodestar/test-utils/mocha";
import {TimestampFormatCode, logFormats} from "../../src/index.js";
import {formatsTestCases} from "../fixtures/loggerFormats.js";
import {getEnvLogger} from "../../src/env.js";

describe("env logger", () => {
  describe("format and options", () => {
    for (const testCase of formatsTestCases) {
      const {id, message, context, error, output} = typeof testCase === "function" ? testCase() : testCase;
      for (const format of logFormats) {
        it(`${id} ${format} output`, async () => {
          // Set env variables
          process.env.LOG_LEVEL = LogLevel.info;
          process.env.LOG_FORMAT = format;
          process.env.LOG_TIMESTAMP_FORMAT = TimestampFormatCode.Hidden;

          const logger = stubLoggerForConsole(getEnvLogger());

          logger.warn(message, context, error);
          logger.restoreStubs();
          expect(logger.getLogs()).deep.equals([output[format]]);
        });
      }
    }
  });
});
