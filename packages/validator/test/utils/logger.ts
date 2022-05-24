import {WinstonLogger, LogLevel} from "@chainsafe/lodestar-utils";
import {getLoggerVc} from "../../src/util/index.js";
import {ClockMock} from "./clock.js";

/**
 * Run the test with ENVs to control log level:
 * ```
 * LOG_LEVEL=debug mocha .ts
 * DEBUG=1 mocha .ts
 * VERBOSE=1 mocha .ts
 * ```
 */
export function testLogger(module?: string): WinstonLogger {
  return new WinstonLogger({level: getLogLevel(), module});
}

function getLogLevel(): LogLevel {
  if (process.env["LOG_LEVEL"]) return process.env["LOG_LEVEL"] as LogLevel;
  if (process.env["DEBUG"]) return LogLevel.debug;
  if (process.env["VERBOSE"]) return LogLevel.verbose;
  return LogLevel.error;
}

export const loggerVc = getLoggerVc(testLogger(), new ClockMock());
