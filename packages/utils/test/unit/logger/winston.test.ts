import fs from "fs";
import path from "path";
import rimraf from "rimraf";
import {Writable} from "stream";
import {Context, ILogger, LodestarError, LogFormat, logFormats, WinstonLogger} from "../../../src";
import {expect} from "chai";
import {TransportType} from "../../../src/logger/transport";

/**
 * To capture Winston output in memory
 */
class WritableMemory extends Writable {
  chunks: Buffer[] = [];
  _write(chunk: Buffer): void {
    this.chunks.push(chunk);
  }

  getAsString(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

describe("winston logger", () => {
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
          const stream = new WritableMemory();
          const logger = new WinstonLogger({format, hideTimestamp: true}, [{type: TransportType.stream, stream}]);
          logger.warn(message, context, error);

          const allOutput = stream.getAsString().trim();
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
      const stream = new WritableMemory();
      const logger = new WinstonLogger({hideTimestamp: true, module: "A"}, [{type: TransportType.stream, stream}]);
      const childB = logger.child({module: "B"});
      const childC = childB.child({module: "C"});
      childC.warn("test");

      // Allow the file transport to persist the file
      await new Promise((r) => setTimeout(r, 10));

      const allOutput = stream.getAsString().trim();
      expect(allOutput).to.equal("[A B C]            \u001b[33mwarn\u001b[39m: test");
    });
  });

  describe("Log to file", () => {
    const tmpDir = fs.mkdtempSync("lodestar-winston-test");

    it("Should log to file", async () => {
      const filename = path.join(tmpDir, "child-logger-test.txt");

      const logger = new WinstonLogger({hideTimestamp: true, module: "A"}, [{type: TransportType.file, filename}]);
      logger.warn("test");

      // Wait for file to exist
      for (let i = 0; i < 200; i++) {
        await new Promise((r) => setTimeout(r, 10));
        if (fs.existsSync(filename)) break;
      }

      const allOutput = fs.readFileSync(filename, "utf8").trim();
      expect(allOutput).to.equal("[A]                \u001b[33mwarn\u001b[39m: test");
    });

    after(() => {
      rimraf.sync(tmpDir);
    });
  });
});
