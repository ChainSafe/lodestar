import fs from "node:fs";
import path from "node:path";
import {expect} from "chai";
import {LogLevel} from "@lodestar/utils";
import {stubLoggerForProcessStd} from "@lodestar/test-utils/mocha";
import {TimestampFormatCode} from "../../src/index.js";
import {getNodeLogger} from "../../src/node.js";
import {readFileWhenExists} from "../utils/files.js";

describe("winston logger", () => {
  describe("winston dynamic level by module", () => {
    it("should log to child at a lower log level", async () => {
      const loggerA = stubLoggerForProcessStd(
        getNodeLogger({
          level: LogLevel.info,
          module: "a",
          format: "human",
          levelModule: {
            "a/b": LogLevel.debug,
          },
          timestampFormat: {format: TimestampFormatCode.Hidden},
        })
      );

      const loggerAB = loggerA.child({module: "b"});

      loggerA.info("test a info"); // show
      loggerA.debug("test a debug"); // skip
      loggerAB.info("test a/b info"); // show
      loggerAB.debug("test a/b debug"); // show

      loggerA.restoreStubs();

      expect(loggerA.getLogs()).deep.equals([
        "[a]                \u001b[32minfo\u001b[39m: test a info",
        "[a/b]              \u001b[32minfo\u001b[39m: test a/b info",
        "[a/b]             \u001b[34mdebug\u001b[39m: test a/b debug",
      ]);
    });
  });

  describe("winston transport log to file", () => {
    let tmpDir: string;

    before(() => {
      tmpDir = fs.mkdtempSync("test-lodestar-winston-test");
    });

    after(() => {
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

      expect(await readFileWhenExists(tmpDir, filenameRx)).to.equal(expectedOut);
    });
  });

  describe("child logger", () => {
    it("should parse child module", async () => {
      const loggerA = stubLoggerForProcessStd(
        getNodeLogger({level: LogLevel.info, timestampFormat: {format: TimestampFormatCode.Hidden}, module: "a"})
      );
      const loggerAB = loggerA.child({module: "b"});
      const loggerABC = loggerAB.child({module: "c"});

      loggerA.warn("test a");
      loggerAB.warn("test a/b");
      loggerABC.warn("test a/b/c");

      loggerA.restoreStubs();

      expect(loggerA.getLogs()).deep.equals([
        "[a]                \u001b[33mwarn\u001b[39m: test a",
        "[a/b]              \u001b[33mwarn\u001b[39m: test a/b",
        "[a/b/c]            \u001b[33mwarn\u001b[39m: test a/b/c",
      ]);
    });
  });
});
