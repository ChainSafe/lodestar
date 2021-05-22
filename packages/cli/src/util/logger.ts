import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  ILogger,
  LogLevel,
  TransportType,
  TransportOpts,
  WinstonLogger,
  TimestampFormat,
  TimestampFormatCode,
} from "@chainsafe/lodestar-utils";

export function errorLogger(): ILogger {
  return new WinstonLogger({level: LogLevel.error});
}

/**
 * Setup a CLI logger, common for beacon, validator and dev commands
 */
export function getCliLogger(
  args: {logLevel?: LogLevel; logLevelFile?: LogLevel; logGenesisTime?: number},
  paths: {logFile?: string},
  config: IBeaconConfig
): ILogger {
  const transports: TransportOpts[] = [{type: TransportType.console}];
  if (paths.logFile) {
    transports.push({type: TransportType.file, filename: paths.logFile, level: args.logLevelFile});
  }

  const timestampFormat: TimestampFormat =
    args.logGenesisTime !== undefined
      ? {
          format: TimestampFormatCode.EpochSlot,
          genesisTime: args.logGenesisTime,
          secondsPerSlot: config.params.SECONDS_PER_SLOT,
          slotsPerEpoch: config.params.SLOTS_PER_EPOCH,
        }
      : {
          format: TimestampFormatCode.DateRegular,
        };

  return new WinstonLogger({level: args.logLevel, timestampFormat}, transports);
}
