import {ILogger, LogLevel, TransportType, TransportOpts, WinstonLogger} from "@chainsafe/lodestar-utils";

export function errorLogger(): ILogger {
  return new WinstonLogger({level: LogLevel.error});
}

/**
 * Setup a CLI logger, common for beacon, validator and dev commands
 */
export function getCliLogger(args: {logLevel?: LogLevel; logLevelFile?: LogLevel}, paths: {logFile?: string}): ILogger {
  const transports: TransportOpts[] = [{type: TransportType.console}];
  if (paths.logFile) {
    transports.push({type: TransportType.file, filename: paths.logFile, level: args.logLevelFile});
  }

  return new WinstonLogger({level: args.logLevel}, transports);
}
