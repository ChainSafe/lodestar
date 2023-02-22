import {createWinstonLogger, LogLevel, Logger} from "@lodestar/utils";

/**
 * Run the test with ENVs to control log level:
 * ```
 * LOG_LEVEL=debug mocha .ts
 * DEBUG=1 mocha .ts
 * VERBOSE=1 mocha .ts
 * ```
 */
export function testLogger(module?: string): Logger {
  return createWinstonLogger({level: getLogLevel(), module});
}

function getLogLevel(): LogLevel {
  if (process.env["LOG_LEVEL"]) return process.env["LOG_LEVEL"] as LogLevel;
  if (process.env["DEBUG"]) return LogLevel.debug;
  if (process.env["VERBOSE"]) return LogLevel.verbose;
  return LogLevel.error;
}
