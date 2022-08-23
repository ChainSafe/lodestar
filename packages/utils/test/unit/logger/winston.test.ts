import chai from "chai";
import sinon from "sinon";
import sinonChai from "sinon-chai";
import {expect} from "chai";
import {LogData, LodestarError, LogFormat, logFormats, LogLevel, WinstonLogger} from "../../../src/index.js";
import {TransportType} from "../../../src/logger/transport.js";

chai.use(sinonChai);

let isNode = true;

// Will be false on browser
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
if (!global.setImmediate) {
  isNode = false;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  global.setImmediate = (cb) => {
    setTimeout(cb, 0);
  };
}

describe("winston logger", () => {
  let loggerSpy: sinon.SinonSpy;

  beforeEach(() => {
    // Will be false on browser
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (process && process.stdout) {
      loggerSpy = sinon.spy(process.stdout, "write");
    } else {
      loggerSpy = sinon.spy(console, "log");
    }
  });

  afterEach(() => {
    // Restore the default sandbox here
    sinon.restore();
  });

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
          const logger = new WinstonLogger({format, hideTimestamp: true}, [{type: TransportType.console}]);
          logger.warn(message, context, error);

          if (isNode) {
            // Nodejs log ends with new lines
            expect(loggerSpy).to.have.been.calledWith(`${output[format]}\n`);
          } else {
            expect(loggerSpy).to.have.been.calledWith(output[format]);
          }
        });
      }
    }
  });

  describe("child logger", () => {
    it("Should parse child module", async () => {
      const logger = new WinstonLogger({hideTimestamp: true, module: "A"}, [{type: TransportType.console}]);
      const childB = logger.child({module: "B"});
      const childC = childB.child({module: "C"});
      childC.warn("test");

      const output = "[A B C]            \u001b[33mwarn\u001b[39m: test";

      if (isNode) {
        // Nodejs log ends with new lines
        expect(loggerSpy).to.have.been.calledWith(`${output}\n`);
      } else {
        expect(loggerSpy).to.have.been.calledWith(output);
      }
    });

    it("Should log to child at a lower logLevel", () => {
      const logger = new WinstonLogger({hideTimestamp: true, module: "A"}, [
        {type: TransportType.console, level: LogLevel.info},
      ]);

      const childB = logger.child({module: "B", level: LogLevel.debug});

      logger.debug("Should not be logged");
      childB.debug("Should be logged");

      const output = "[A B]             \u001b[34mdebug\u001b[39m: Should be logged";

      if (isNode) {
        // Nodejs log ends with new lines
        expect(loggerSpy).to.have.been.calledWith(`${output}\n`);
      } else {
        expect(loggerSpy).to.have.been.calledWith(output);
      }
    });
  });
});
