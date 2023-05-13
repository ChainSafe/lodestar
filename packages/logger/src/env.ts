import winston from "winston";
import {Logger, LogLevel} from "@lodestar/utils";
import {TimestampFormat} from "./interface.js";
import {createWinstonLogger} from "./logger/winston.js";
export {LogLevel};

export type LoggerEnvOpts = {
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
export function getEnvLogger(module?: string, opts?: LoggerEnvOpts): Logger {
  const transports: winston.transport[] = [
    new winston.transports.Console({level: getLogLevelFromEnvs() || opts?.logLevel || LogLevel.error}),
  ];
  if (opts?.logFile) {
    transports.push(
      new winston.transports.File({
        level: LogLevel.debug,
        filename: opts.logFile,
      })
    );
  }

  return createWinstonLogger({module, ...opts}, transports);
}

function getLogLevelFromEnvs(): LogLevel | null {
  if (process.env["LOG_LEVEL"]) return process.env["LOG_LEVEL"] as LogLevel;
  if (process.env["DEBUG"]) return LogLevel.debug;
  if (process.env["VERBOSE"]) return LogLevel.verbose;
  return null;
}
