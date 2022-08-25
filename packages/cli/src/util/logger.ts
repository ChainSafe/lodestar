import {IChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  ILogger,
  LogLevel,
  TransportType,
  TransportOpts,
  WinstonLogger,
  TimestampFormat,
  TimestampFormatCode,
} from "@lodestar/utils";

export const defaultLogMaxFiles = 5;

export interface ILogArgs {
  logLevel?: LogLevel;
  logFileLevel?: LogLevel;
  logFormatGenesisTime?: number;
  logFormatId?: string;
  logFileDailyRotate?: number;
}

export function errorLogger(): ILogger {
  return new WinstonLogger({level: LogLevel.error});
}

/**
 * Setup a CLI logger, common for beacon, validator and dev commands
 */
export function getCliLogger(args: ILogArgs, paths: {logFile?: string}, config: IChainForkConfig): ILogger {
  const transports: TransportOpts[] = [{type: TransportType.console}];
  if (paths.logFile) {
    transports.push({
      type: TransportType.file,
      filename: paths.logFile,
      level: args.logFileLevel,
      // yargs populates with undefined if just set but with no arg
      // $ ./bin/lodestar.js beacon --logFileDailyRotate
      // args = {
      //   logFileDailyRotate: undefined,
      // }
      rotate: "logFileDailyRotate" in args,
      maxfiles: args.logFileDailyRotate ?? defaultLogMaxFiles,
    });
  }

  const timestampFormat: TimestampFormat =
    args.logFormatGenesisTime !== undefined
      ? {
          format: TimestampFormatCode.EpochSlot,
          genesisTime: args.logFormatGenesisTime,
          secondsPerSlot: config.SECONDS_PER_SLOT,
          slotsPerEpoch: SLOTS_PER_EPOCH,
        }
      : {
          format: TimestampFormatCode.DateRegular,
        };

  return new WinstonLogger({level: args.logLevel, module: args.logFormatId, timestampFormat}, transports);
}
