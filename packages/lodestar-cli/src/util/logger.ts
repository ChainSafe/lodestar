import {ILogger, LogLevel, TransportType, WinstonLogger} from "@chainsafe/lodestar-utils";

export function errorLogger(): ILogger {
  return new WinstonLogger({level: LogLevel.error});
}

/**
 * Setup a CLI logger, common for beacon, validator and dev commands
 */
export function getCliLogger(args: {logLevel?: LogLevel; logLevelFile?: LogLevel}, paths: {logFile?: string}): ILogger {
  return new WinstonLogger({level: args.logLevel}, [
    {type: TransportType.console},
    ...(paths.logFile ? [{type: TransportType.file, filename: paths.logFile, level: args.logLevelFile}] : []),
  ]);
}
