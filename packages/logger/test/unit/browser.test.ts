import {expect} from "chai";
import {LogLevel} from "@lodestar/utils";
import {stubLoggerForConsole} from "@lodestar/test-utils/mocha";
import {TimestampFormatCode, logFormats} from "../../src/index.js";
import {formatsTestCases} from "../fixtures/loggerFormats.js";
import {getBrowserLogger} from "../../src/browser.js";

describe("browser logger", () => {
  describe("format and options", () => {
    for (const testCase of formatsTestCases) {
      const {id, message, context, error, output} = typeof testCase === "function" ? testCase() : testCase;
      for (const format of logFormats) {
        it(`${id} ${format} output`, async () => {
          const logger = stubLoggerForConsole(
            getBrowserLogger({level: LogLevel.info, format, timestampFormat: {format: TimestampFormatCode.Hidden}})
          );

          logger.warn(message, context, error);
          logger.restoreStubs();
          expect(logger.getLogs()).deep.equals([output[format]]);
        });
      }
    }
  });
});
