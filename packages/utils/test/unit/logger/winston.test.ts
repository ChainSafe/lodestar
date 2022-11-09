import "../../setup.js";
import {expect} from "chai";
import {MESSAGE} from "triple-beam";
import Transport from "winston-transport";
import {LogData, LodestarError, LogFormat, logFormats, createWinstonLogger} from "../../../src/index.js";

type WinstonLog = {[MESSAGE]: string};

class MemoryTransport extends Transport {
  private readonly logs: WinstonLog[] = [];

  log(info: WinstonLog, next: () => void): void {
    this.logs.push(info);
    next();
  }

  getLogs(): string[] {
    return this.logs.map((log) => log[MESSAGE]);
  }
}

// describe("winston logger log level logic", () => {
//   it("Should not run format function for not used log level", () => {
//     const logger = createWinstonLogger({format, hideTimestamp: true}, [new MemoryTransport()]);
//   });
// });

describe("winston logger", () => {
  describe("winston logger format and options", () => {
    interface ITestCase {
      id: string;
      message: string;
      context?: LogData;
      error?: Error;
      output: {[P in LogFormat]: string};
    }
    /* eslint-disable quotes */
    const testCases: (ITestCase | (() => ITestCase))[] = [
      {
        id: "regular log with metadata",
        message: "foo bar",
        context: {meta: "data"},
        output: {
          human: "[]                 \u001b[33mwarn\u001b[39m: foo bar meta=data",
          json: `{"message":"foo bar","context":{"meta":"data"},"level":"warn","module":""}`,
        },
      },

      {
        id: "regular log with big int metadata",
        message: "big int",
        context: {data: BigInt(1)},
        output: {
          human: "[]                 \u001b[33mwarn\u001b[39m: big int data=1",
          json: `{"message":"big int","context":{"data":"1"},"level":"warn","module":""}`,
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
            json: `{"message":"foo bar","error":{"code":"SAMPLE_ERROR","data":{"foo":"bar"},"stack":"$STACK"},"level":"warn","module":""}`,
          },
        };
      },
    ];

    for (const testCase of testCases) {
      const {id, message, context, error, output} = typeof testCase === "function" ? testCase() : testCase;
      for (const format of logFormats) {
        it(`${id} ${format} output`, async () => {
          const memoryTransport = new MemoryTransport();
          const logger = createWinstonLogger({format, hideTimestamp: true}, [memoryTransport]);
          logger.warn(message, context, error);

          expect(memoryTransport.getLogs()).deep.equals([output[format]]);
        });
      }
    }
  });

  describe("child logger", () => {
    it("Should parse child module", async () => {
      const memoryTransport = new MemoryTransport();
      const loggerA = createWinstonLogger({hideTimestamp: true, module: "a"}, [memoryTransport]);
      const loggerAB = loggerA.child({module: "b"});
      const loggerABC = loggerAB.child({module: "c"});

      loggerA.warn("test a");
      loggerAB.warn("test a/b");
      loggerABC.warn("test a/b/c");

      expect(memoryTransport.getLogs()).deep.equals([
        "[a]                \u001b[33mwarn\u001b[39m: test a",
        "[a/b]              \u001b[33mwarn\u001b[39m: test a/b",
        "[a/b/c]            \u001b[33mwarn\u001b[39m: test a/b/c",
      ]);
    });
  });
});
