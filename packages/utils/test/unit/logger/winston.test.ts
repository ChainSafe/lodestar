import fs from "fs";
import path from "path";
import rimraf from "rimraf";
import {Context, ILogger, LodestarError, LogFormat, logFormats, WinstonLogger} from "../../../src";
import {expect} from "chai";
import {TransportType} from "../../../src/logger/transport";

describe("winston logger", () => {
  const tmpDir = fs.mkdtempSync("lodestar-winston-test");
  after(() => {
    rimraf.sync(tmpDir);
  });

  describe("winston logger format and options", () => {
    interface ITestCase {
      id: string;
      message: string;
      context?: Context;
      error?: Error;
      output: {[P in LogFormat]: string};
    }
    const testCases: (ITestCase | (() => ITestCase))[] = [
      {
        id: "regular log with metadata",
        message: "foo bar",
        context: {meta: "data"},
        output: {
          human: "[]                 \u001b[33mwarn\u001b[39m: foo bar meta=data",
          // eslint-disable-next-line quotes
          json: `{"module":"","context":{"meta":"data"},"level":"warn","message":"foo bar"}`,
        },
      },

      {
        id: "regular log with big int metadata",
        message: "big int",
        context: {data: BigInt(1)},
        output: {
          human: "[]                 \u001b[33mwarn\u001b[39m: big int data=1",
          // eslint-disable-next-line quotes
          json: `{"module":"","context":{"data":"1"},"level":"warn","message":"big int"}`,
        },
      },

      () => {
        const error = new LodestarError({code: "SAMPLE_ERROR", data: {foo: "bar"}});
        error.stack = "$STACK";
        return {
          id: "error with metadata",
          opts: {format: "human", module: "SAMPLE"},
          message: "foo bar",
          error: error,
          output: {
            human: `[]                 \u001b[33mwarn\u001b[39m: foo bar code=SAMPLE_ERROR, data={"foo":"bar"}\n${error.stack}`,
            // eslint-disable-next-line quotes
            json: `{"module":"","error":{"code":"SAMPLE_ERROR","data":{"foo":"bar"},"stack":"$STACK"},"level":"warn","message":"foo bar"}`,
          },
        };
      },
    ];

    for (const testCase of testCases) {
      const {id, message, context, error, output} = typeof testCase === "function" ? testCase() : testCase;
      for (const format of logFormats) {
        it(`${id} ${format} output`, async () => {
          const filename = path.join(tmpDir, `${id.replace(/\s+/g, "-")}-${format}.txt`);

          const logger = new WinstonLogger({format, hideTimestamp: true}, [{type: TransportType.file, filename}]);
          logger.warn(message, context, error);

          // Allow the file transport to persist the file
          await new Promise((r) => setTimeout(r, 10));

          const allOutput = fs.readFileSync(filename, "utf8").trim();
          expect(allOutput).to.equal(output[format]);
        });
      }
    }
  });

  describe("profile", () => {
    it("should log profile", () => {
      const logger: ILogger = new WinstonLogger();

      logger.profile("test");

      setTimeout(function () {
        //
        // Stop profile of 'test'. Logging will now take place:
        //   '17 Jan 21:00:00 - info: test duration=10ms'
        //
        logger.profile("test");
      }, 10);
    });
  });

  describe("child logger", () => {
    it("Should parse child module", async () => {
      const filename = path.join(tmpDir, "child-logger-test.txt");

      const logger = new WinstonLogger({hideTimestamp: true, module: "A"}, [{type: TransportType.file, filename}]);
      const childB = logger.child({module: "B"});
      const childC = childB.child({module: "C"});
      childC.warn("test");

      // Allow the file transport to persist the file
      await new Promise((r) => setTimeout(r, 10));

      const allOutput = fs.readFileSync(filename, "utf8").trim();
      expect(allOutput).to.equal("[A B C]            \u001b[33mwarn\u001b[39m: test");
    });
  });
});
