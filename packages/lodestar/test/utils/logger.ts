/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import {WinstonLogger, LogLevel, TransportType, TransportOpts} from "@chainsafe/lodestar-utils";
export {LogLevel};

/**
 * Run the test with ENVs to control log level:
 * ```
 * LOG_LEVEL=debug mocha .ts
 * DEBUG=1 mocha .ts
 * VERBOSE=1 mocha .ts
 * ```
 */
export function testLogger(module?: string, defaultLogLevel = LogLevel.error, logFile?: string): WinstonLogger {
  const transports: TransportOpts[] = [{type: TransportType.console}];
  if (logFile) {
    transports.push({type: TransportType.file, filename: logFile, level: LogLevel.debug});
  }

  return new WinstonLogger({level: getLogLevelFromEnvs() || defaultLogLevel, module}, transports);
}

function getLogLevelFromEnvs(): LogLevel | null {
  if (process.env["LOG_LEVEL"]) return process.env["LOG_LEVEL"] as LogLevel;
  if (process.env["DEBUG"]) return LogLevel.debug;
  if (process.env["VERBOSE"]) return LogLevel.verbose;
  return null;
}
