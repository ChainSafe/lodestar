import {describe, it, expect} from "vitest";
import {LogLevel} from "@lodestar/utils";
import {stubLoggerForConsole} from "@lodestar/test-utils/doubles";
import {TimestampFormatCode, logFormats} from "../../src/index.js";
import {formatsTestCases} from "../fixtures/loggerFormats.js";
import {getBrowserLogger} from "../../src/browser.js";

describe("browser logger", () => {
  describe("format and options", () => {
    for (const testCase of formatsTestCases) {
      const {id, opts, message, context, error, output} = typeof testCase === "function" ? testCase() : testCase;
      for (const format of logFormats) {
        it(`${id} ${format} output`, async () => {
          const logger = stubLoggerForConsole(
            getBrowserLogger({
              level: LogLevel.info,
              format,
              module: opts?.module,
              timestampFormat: {format: TimestampFormatCode.Hidden},
            })
          );

          logger.warn(message, context, error);
          logger.restoreStubs();
          expect(logger.getLogs()).toEqual([output[format]]);
        });
      }
    }
  });
});
