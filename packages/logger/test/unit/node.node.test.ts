import {expect} from "chai";
import {LogLevel} from "@lodestar/utils";
import {stubLoggerForProcessStd} from "@lodestar/test-utils/mocha";
import {TimestampFormatCode, logFormats} from "../../src/index.js";
import {getNodeLogger} from "../../src/node.js";
import {formatsTestCases} from "../fixtures/loggerFormats.js";

describe("node logger", () => {
  describe("format and options", () => {
    for (const testCase of formatsTestCases) {
      const {id, message, context, error, output} = typeof testCase === "function" ? testCase() : testCase;
      for (const format of logFormats) {
        it(`${id} ${format} output`, async () => {
          const logger = stubLoggerForProcessStd(
            getNodeLogger({
              level: LogLevel.info,
              format,
              timestampFormat: {format: TimestampFormatCode.Hidden},
            })
          );
          logger.warn(message, context, error);
          logger.restoreStubs();
          expect(logger.getLogs()).deep.equals([output[format]]);
        });
      }
    }
  });
});
