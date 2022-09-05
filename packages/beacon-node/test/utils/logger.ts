/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import winston from "winston";
import {WinstonLogger, LogLevel, TimestampFormat} from "@lodestar/utils";
export {LogLevel};

export type TestLoggerOpts = {
  logLevel?: LogLevel;
  logFile?: string;
  timestampFormat?: TimestampFormat;
};

/**
 * Run the test with ENVs to control log level:
 * ```
 * LOG_LEVEL=debug mocha .ts
 * DEBUG=1 mocha .ts
 * VERBOSE=1 mocha .ts
 * ```
 */
export function testLogger(module?: string, opts?: TestLoggerOpts): WinstonLogger {
  const transports: winston.transport[] = [
    new winston.transports.Console({
      debugStdout: true,
      level: getLogLevelFromEnvs() || opts?.logLevel || LogLevel.error,
      handleExceptions: true,
    }),
  ];
  if (opts?.logFile) {
    transports.push(
      new winston.transports.File({
        level: LogLevel.debug,
        filename: opts.logFile,
        handleExceptions: true,
      })
    );
  }

  return new WinstonLogger({module, ...opts}, transports);
}

function getLogLevelFromEnvs(): LogLevel | null {
  if (process.env["LOG_LEVEL"]) return process.env["LOG_LEVEL"] as LogLevel;
  if (process.env["DEBUG"]) return LogLevel.debug;
  if (process.env["VERBOSE"]) return LogLevel.verbose;
  return null;
}
