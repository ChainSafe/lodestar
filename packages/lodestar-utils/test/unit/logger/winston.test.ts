import {Context, ILogger, LodestarError, LogFormat, logFormats, WinstonLogger} from "../../../src";
import TransportStream from "winston-transport";
import {MESSAGE} from "triple-beam";
import {expect} from "chai";

/**
 * Transport logging to provided callback
 */
class CallbackTransport extends TransportStream {
  callback: (data: string) => void;
  constructor(callback: (data: string) => void) {
    super();
    this.callback = callback;
  }
  log(info: any): void {
    this.callback(info[MESSAGE]);
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
            human: `[]                 \u001b[33mwarn\u001b[39m: foo bar code=SAMPLE_ERROR, data={"foo":"bar"} \n${error.stack}`,
            // eslint-disable-next-line quotes
            json: `{"module":"","error":{"code":"SAMPLE_ERROR","data":{"foo":"bar"},"stack":"$STACK"},"level":"warn","message":"foo bar"}`,
          },
        };
      },
    ];

    for (const testCase of testCases) {
      const {id, message, context, error, output} = typeof testCase === "function" ? testCase() : testCase;
      for (const format of logFormats) {
        it(`${id} ${format} output`, () => {
          let allOutput = "";
          const callbackTransport = new CallbackTransport((data: any) => (allOutput += data));
          const logger = new WinstonLogger({format, hideTimestamp: true}, [callbackTransport]);
          logger.warn(message, context, error);
          expect(allOutput).to.equal(output[format]);
        });
      }
    }
  });

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
