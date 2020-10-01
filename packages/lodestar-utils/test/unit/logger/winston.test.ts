import {Context, ILogger, ILoggerOptions, LodestarError, WinstonLogger} from "../../../src";
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

describe.only("winston logger", () => {
  describe("winston logger format and options", () => {
    interface ITestCase {
      id: string;
      message: string;
      context?: Context | Error;
      outputHuman: string;
      outputJson: string;
    }
    const testCases: (ITestCase | (() => ITestCase))[] = [
      {
        id: "regular log with metadata",
        message: "foo bar",
        context: {meta: "data"},
        // Ignore the variable timestamp part
        outputHuman: "\u001b[33mwarn\u001b[39m: foo bar meta=data",
        // eslint-disable-next-line quotes
        outputJson: '{"module":"","context":{"meta":"data"},"level":"warn","message":"foo bar"',
      },

      () => {
        const error = new LodestarError({code: "SAMPLE_ERROR", data: {foo: "bar"}});
        return {
          id: "error with metadata",
          opts: {format: "human", module: "SAMPLE"},
          message: "foo bar",
          context: error,
          // Ignore the variable timestamp part
          outputHuman:
            "\u001b[33mwarn\u001b[39m: foo bar code=SAMPLE_ERROR, data=[foo=bar], message=SAMPLE_ERROR\n" + error.stack,
          // eslint-disable-next-line quotes
          outputJson: `{"module":"","context":{"code":"SAMPLE_ERROR","data":{"foo":"bar"},"message":"SAMPLE_ERROR","stack"`,
        };
      },
    ];

    for (const testCase of testCases) {
      const {id, message, context, outputHuman, outputJson} = typeof testCase === "function" ? testCase() : testCase;
      it(`${id} human output`, () => {
        let output = "";
        const callbackTransport = new CallbackTransport((data: any) => (output += data));
        const logger = new WinstonLogger({format: "human"}, [callbackTransport]);
        logger.warn(message, context);
        expect(output).to.include(outputHuman);
      });
      it(`${id} json output`, () => {
        let output = "";
        const callbackTransport = new CallbackTransport((data: any) => (output += data));
        const logger = new WinstonLogger({format: "json"}, [callbackTransport]);
        logger.warn(message, context);
        expect(output).to.include(outputJson);
      });
    }
  });

  it("should log profile", () => {
    const logger: ILogger = new WinstonLogger();

    logger.profile("test");

    setTimeout(function () {
      //
      // Stop profile of 'test'. Logging will now take place:
      //   '17 Jan 21:00:00 - info: test duration=1000ms'
      //
      logger.profile("test");
    }, 100);
  });
});
