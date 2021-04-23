/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import {WinstonLogger, LogLevel, TransportType, TransportOpts, TimestampFormat} from "@chainsafe/lodestar-utils";
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
  const transports: TransportOpts[] = [
    {type: TransportType.console, level: getLogLevelFromEnvs() || opts?.logLevel || LogLevel.error},
  ];
  if (opts?.logFile) {
    transports.push({type: TransportType.file, filename: opts.logFile, level: LogLevel.debug});
  }

  return new WinstonLogger({module, ...opts}, transports);
}

function getLogLevelFromEnvs(): LogLevel | null {
  if (process.env["LOG_LEVEL"]) return process.env["LOG_LEVEL"] as LogLevel;
  if (process.env["DEBUG"]) return LogLevel.debug;
  if (process.env["VERBOSE"]) return LogLevel.verbose;
  return null;
}
