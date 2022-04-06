import fs from "node:fs";
import path from "node:path";
import rimraf from "rimraf";
import {Writable} from "node:stream";
import {expect} from "chai";
import {LogData, LodestarError, LogFormat, logFormats, LogLevel, WinstonLogger} from "../../../src";
import {TransportType} from "../../../src/logger/transport.js";

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
      context?: LogData;
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
            human: `[]                 \u001b[33mwarn\u001b[39m: foo bar code=SAMPLE_ERROR, data=foo=bar\n${error.stack}`,
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

          expect(stream.getAsString().trim()).to.equal(output[format]);
        });
      }
    }
  });

  describe("child logger", () => {
    it("Should parse child module", async () => {
      const stream = new WritableMemory();
      const logger = new WinstonLogger({hideTimestamp: true, module: "A"}, [{type: TransportType.stream, stream}]);
      const childB = logger.child({module: "B"});
      const childC = childB.child({module: "C"});
      childC.warn("test");

      expect(stream.getAsString().trim()).to.equal("[A B C]            \u001b[33mwarn\u001b[39m: test");
    });

    it("Should log to child at a lower logLevel", () => {
      const stream = new WritableMemory();
      const logger = new WinstonLogger({hideTimestamp: true, module: "A"}, [
        {type: TransportType.stream, stream, level: LogLevel.info},
      ]);

      const childB = logger.child({module: "B", level: LogLevel.debug});

      logger.debug("Should not be logged");
      childB.debug("Should be logged");

      expect(stream.getAsString().trim()).to.equal("[A B]             \u001b[34mdebug\u001b[39m: Should be logged");
    });
  });

  describe("Log to file", () => {
    let tmpDir: string;

    before(() => {
      tmpDir = fs.mkdtempSync("test-lodestar-winston-test");
    });

    it("Should log to file", async () => {
      const filename = path.join(tmpDir, "child-logger-test.txt");

      const logger = new WinstonLogger({hideTimestamp: true, module: "A"}, [{type: TransportType.file, filename}]);
      logger.warn("test");

      const output = await readFileWhenExists(filename);
      expect(output).to.equal("[A]                \u001b[33mwarn\u001b[39m: test");
    });

    after(() => {
      rimraf.sync(tmpDir);
    });
  });
});

/** Wait for file to exist have some content, then return its contents */
async function readFileWhenExists(filepath: string): Promise<string> {
  for (let i = 0; i < 200; i++) {
    try {
      const data = fs.readFileSync(filepath, "utf8").trim();
      // Winston will first create the file then write to it
      if (data) return data;
    } catch (e) {
      if ((e as IoError).code !== "ENOENT") throw e;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("Timeout");
}

type IoError = {code: string};
