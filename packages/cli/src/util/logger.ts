import path from "node:path";
import DailyRotateFile from "winston-daily-rotate-file";
import TransportStream from "winston-transport";
import winston from "winston";
import {IChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  ILogger,
  LogLevel,
  createWinstonLogger,
  TimestampFormat,
  TimestampFormatCode,
  LogFormat,
  logFormats,
} from "@lodestar/utils";
import {ConsoleDynamicLevel} from "./loggerConsoleTransport.js";

export const defaultLogMaxFiles = 5;

export interface ILogArgs {
  logLevel?: LogLevel;
  logFileLevel?: LogLevel;
  logFileDailyRotate?: number;
  logFormatGenesisTime?: number;
  logPrefix?: string;
  logFormat?: string;
  logLevelModule?: string[];
}

/**
 * Setup a CLI logger, common for beacon, validator and dev commands
 */
export function getCliLogger(
  args: ILogArgs,
  paths: {logFile?: string},
  config: IChainForkConfig,
  opts?: {hideTimestamp?: boolean}
): ILogger {
  const consoleTransport = new ConsoleDynamicLevel({
    // Set defaultLevel, not level for dynamic level setting of ConsoleDynamicLevel
    defaultLevel: args.logLevel ?? LogLevel.info,
    debugStdout: true,
    handleExceptions: true,
  });

  if (args.logLevelModule) {
    for (const logLevelModule of args.logLevelModule ?? []) {
      const [module, levelStr] = logLevelModule.split("=");
      const level = levelStr as LogLevel;
      if (LogLevel[level as LogLevel] === undefined) {
        throw Error(`Unknown level in logLevelModule '${logLevelModule}'`);
      }

      consoleTransport.setModuleLevel(module, level);
    }
  }

  const transports: TransportStream[] = [consoleTransport];

  if (paths.logFile) {
    // yargs populates with undefined if just set but with no arg
    // $ ./bin/lodestar.js beacon --logFileDailyRotate
    // args = {
    //   logFileDailyRotate: undefined,
    // }
    const rotateMaxFiles = args.logFileDailyRotate ?? 0;
    const filename = paths.logFile;

    transports.push(
      rotateMaxFiles > 0
        ? new DailyRotateFile({
            level: args.logFileLevel,
            //insert the date pattern in filename before the file extension.
            filename: filename.replace(/\.(?=[^.]*$)|$/, "-%DATE%$&"),
            datePattern: "YYYY-MM-DD",
            handleExceptions: true,
            maxFiles: rotateMaxFiles,
            auditFile: path.join(path.dirname(filename), ".log_rotate_audit.json"),
          })
        : new winston.transports.File({
            level: args.logFileLevel,
            filename: filename,
            handleExceptions: true,
          })
    );
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

  return createWinstonLogger(
    {
      module: args.logPrefix,
      format: args.logFormat ? parseLogFormat(args.logFormat) : "human",
      timestampFormat,
      hideTimestamp: opts?.hideTimestamp,
    },
    transports
  );
}

function parseLogFormat(format: string): LogFormat {
  if (!logFormats.includes(format as LogFormat)) {
    throw Error(`Invalid log format '${format}'`);
  }

  return format as LogFormat;
}
