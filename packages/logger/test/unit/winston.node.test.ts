import fs from "node:fs";
import path from "node:path";
import {describe, it, expect, beforeAll, afterAll, afterEach, vi, Mock} from "vitest";
import {LogLevel} from "@lodestar/utils";
import {TimestampFormatCode} from "../../src/index.js";
import {getNodeLogger} from "../../src/node.js";
import {readFileWhenExists} from "../utils/files.js";

// Node.js maps `process.stdout` to `console._stdout`.
// spy does not work on `process.stdout` directly.
type TestConsole = typeof console & {_stdout: {write: Mock}};

describe("winston logger", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("winston dynamic level by module", () => {
    it("should log to child at a lower log level", async () => {
      vi.spyOn((console as TestConsole)._stdout, "write");

      const loggerA = getNodeLogger({
        level: LogLevel.info,
        module: "a",
        format: "human",
        levelModule: {
          "a/b": LogLevel.debug,
        },
        timestampFormat: {format: TimestampFormatCode.Hidden},
      });

      const loggerAB = loggerA.child({module: "b"});

      loggerA.info("test a info"); // show
      loggerA.debug("test a debug"); // skip
      loggerAB.info("test a/b info"); // show
      loggerAB.debug("test a/b debug"); // show

      expect((console as TestConsole)._stdout.write).toHaveBeenNthCalledWith(
        1,
        "[a]                \u001b[32minfo\u001b[39m: test a info\n"
      );

      expect((console as TestConsole)._stdout.write).toHaveBeenNthCalledWith(
        2,
        "[a/b]              \u001b[32minfo\u001b[39m: test a/b info\n"
      );

      expect((console as TestConsole)._stdout.write).toHaveBeenNthCalledWith(
        3,
        "[a/b]             \u001b[34mdebug\u001b[39m: test a/b debug\n"
      );
    });
  });

  describe("winston transport log to file", () => {
    let tmpDir: string;

    beforeAll(() => {
      tmpDir = fs.mkdtempSync("test-lodestar-winston-test");
    });

    afterAll(() => {
      fs.rmSync(tmpDir, {recursive: true});
    });

    it("Should log to file", async () => {
      const filename = "child-logger-test.log";
      // filename is mutated to include the data before the extension
      const filenameRx = /^child-logger-test/;
      const filepath = path.join(tmpDir, filename);

      const logger = getNodeLogger({
        module: "a",
        level: LogLevel.info,
        timestampFormat: {format: TimestampFormatCode.Hidden},
        file: {
          filepath,
          level: LogLevel.info,
          dailyRotate: 5,
        },
      });

      logger.warn("test");

      const expectedOut = "[a]                \u001b[33mwarn\u001b[39m: test";

      expect(await readFileWhenExists(tmpDir, filenameRx)).toBe(expectedOut);
    });
  });

  describe("child logger", () => {
    it("should parse child module", async () => {
      vi.spyOn((console as TestConsole)._stdout, "write");

      const loggerA = getNodeLogger({
        level: LogLevel.info,
        timestampFormat: {format: TimestampFormatCode.Hidden},
        module: "a",
      });

      const loggerAB = loggerA.child({module: "b"});
      const loggerABC = loggerAB.child({module: "c"});

      loggerA.warn("test a");
      loggerAB.warn("test a/b");
      loggerABC.warn("test a/b/c");

      expect((console as TestConsole)._stdout.write).toHaveBeenNthCalledWith(
        1,
        "[a]                \u001b[33mwarn\u001b[39m: test a\n"
      );
      expect((console as TestConsole)._stdout.write).toHaveBeenNthCalledWith(
        2,
        "[a/b]              \u001b[33mwarn\u001b[39m: test a/b\n"
      );
      expect((console as TestConsole)._stdout.write).toHaveBeenNthCalledWith(
        3,
        "[a/b/c]            \u001b[33mwarn\u001b[39m: test a/b/c\n"
      );
    });
  });
});
