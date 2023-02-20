import fs from "node:fs";
import path from "node:path";
import rimraf from "rimraf";
import {expect} from "chai";
import {config} from "@lodestar/config/default";
import {Logger, LodestarError, LogData, LogFormat, logFormats, LogLevel} from "@lodestar/utils";
import {getCliLogger, LogArgs, LOG_FILE_DISABLE_KEYWORD} from "../../../src/util/logger.js";

describe("winston logger format and options", () => {
  type TestCase = {
    id: string;
    message: string;
    context?: LogData;
    error?: Error;
    output: {[P in LogFormat]: string};
  };
  /* eslint-disable quotes */
  const testCases: (TestCase | (() => TestCase))[] = [
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

  let stdoutHook: ReturnType<typeof hookProcessStdout> | null = null;
  afterEach(() => stdoutHook?.restore());

  for (const testCase of testCases) {
    const {id, message, context, error, output} = typeof testCase === "function" ? testCase() : testCase;
    for (const format of logFormats) {
      it(`${id} ${format} output`, async () => {
        stdoutHook = hookProcessStdout();

        const logger = getCliLoggerTest({logFormat: format});

        logger.warn(message, context, error);

        expect(stdoutHook.chunks.join("").trim()).to.equal(output[format]);

        stdoutHook.restore();
      });
    }
  }
});

describe("winston dynamic level by module", () => {
  // Tested manually that if an error is thrown in the body after hooking to stdout, the error is visible
  // in the status render of the mocha it() block
  let stdoutHook: ReturnType<typeof hookProcessStdout> | null = null;
  afterEach(() => stdoutHook?.restore());

  it("Should log to child at a lower logLevel", async () => {
    const loggerA = getCliLoggerTest({logPrefix: "a", logLevelModule: [`a/b=${LogLevel.debug}`]});

    stdoutHook = hookProcessStdout();

    const loggerAB = loggerA.child({module: "b"});

    loggerA.info("test a info"); // show
    loggerA.debug("test a debug"); // skip
    loggerAB.info("test a/b info"); // show
    loggerAB.debug("test a/b debug"); // show

    await new Promise((r) => setTimeout(r, 1));

    expect(stdoutHook.chunks).deep.equals([
      "[a]                \u001b[32minfo\u001b[39m: test a info\n",
      "[a/b]              \u001b[32minfo\u001b[39m: test a/b info\n",
      "[a/b]             \u001b[34mdebug\u001b[39m: test a/b debug\n",
    ]);

    // Call at the end on success to print the result
    stdoutHook.restore();
  });
});

describe("winston transport log to file", () => {
  let tmpDir: string;
  let stdoutHook: ReturnType<typeof hookProcessStdout> | null = null;
  afterEach(() => stdoutHook?.restore());

  before(() => {
    tmpDir = fs.mkdtempSync("test-lodestar-winston-test");
  });

  it("Should log to file", async () => {
    const filename = "child-logger-test.log";
    // filename is mutated to include the data before the extension
    const filenameRx = /^child-logger-test/;
    const filepath = path.join(tmpDir, filename);

    const logger = getCliLoggerTest({logPrefix: "a", logFile: filepath});

    stdoutHook = hookProcessStdout();

    logger.warn("test");

    const expectedOut = "[a]                \u001b[33mwarn\u001b[39m: test";

    expect(await readFileWhenExists(tmpDir, filenameRx)).to.equal(expectedOut);

    expect(stdoutHook.chunks).deep.equals([expectedOut + "\n"]);
    stdoutHook.restore();
  });

  after(() => {
    rimraf.sync(tmpDir);
  });
});

function getCliLoggerTest(logArgs: Partial<LogArgs>): Logger {
  return getCliLogger(
    {logFile: LOG_FILE_DISABLE_KEYWORD, ...logArgs},
    {defaultLogFilepath: "logger_transport_test.log"},
    config,
    {hideTimestamp: true}
  ).logger;
}

/** Wait for file to exist have some content, then return its contents */
async function readFileWhenExists(dirpath: string, filenameRx: RegExp): Promise<string> {
  for (let i = 0; i < 200; i++) {
    try {
      const files = fs.readdirSync(dirpath);
      const filename = files.find((file) => filenameRx.test(file));
      if (filename !== undefined) {
        const data = fs.readFileSync(path.join(dirpath, filename), "utf8").trim();
        // Winston will first create the file then write to it
        if (data) return data;
      }
    } catch (e) {
      if ((e as IoError).code !== "ENOENT") throw e;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("Timeout");
}

type IoError = {code: string};

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function hookProcessStdout() {
  const processStdoutWrite = process.stdout.write;
  const chunks: string[] = [];

  process.stdout.write = (chunk) => {
    chunks.push(chunk.toString());
    return true;
  };

  return {
    chunks,
    restore() {
      process.stdout.write = processStdoutWrite;
    },
  };
}
