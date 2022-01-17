import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {
  ILogger,
  LogLevel,
  TransportType,
  TransportOpts,
  WinstonLogger,
  TimestampFormat,
  TimestampFormatCode,
} from "@chainsafe/lodestar-utils";

export interface ILogArgs {
  logLevel?: LogLevel;
  logLevelFile?: LogLevel;
  logFormatGenesisTime?: number;
  logFormatId?: string;
  logRotate?: boolean;
  logMaxFiles?: number;
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
      level: args.logLevelFile,
      rotate: args.logRotate,
      maxfiles: args.logMaxFiles,
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
