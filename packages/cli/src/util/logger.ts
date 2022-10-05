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
import {IGlobalArgs} from "../options/globalOptions.js";
import {ConsoleDynamicLevel} from "./loggerConsoleTransport.js";

export const LOG_FILE_DISABLE_KEYWORD = "none";
export const LOG_LEVEL_DEFAULT = LogLevel.info;
export const LOG_FILE_LEVEL_DEFAULT = LogLevel.debug;
export const LOG_DAILY_ROTATE_DEFAULT = 5;

export interface ILogArgs {
  logLevel?: LogLevel;
  logFile?: string;
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
  args: ILogArgs & Pick<IGlobalArgs, "dataDir">,
  paths: {defaultLogFilepath: string},
  config: IChainForkConfig,
  opts?: {hideTimestamp?: boolean}
): ILogger {
  const consoleTransport = new ConsoleDynamicLevel({
    // Set defaultLevel, not level for dynamic level setting of ConsoleDynamicLvevel
    defaultLevel: args.logLevel ?? LOG_LEVEL_DEFAULT,
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

  if (args.logFile !== LOG_FILE_DISABLE_KEYWORD) {
    // yargs populates with undefined if just set but with no arg
    // $ ./bin/lodestar.js beacon --logFileDailyRotate
    // args = {
    //   logFileDailyRotate: undefined,
    // }
    // `lodestar --logFileDailyRotate` -> enabled daily rotate with default value
    // `lodestar --logFileDailyRotate 10` -> set daily rotate to custom value 10
    // `lodestar --logFileDailyRotate 0` -> disable daily rotate and accumulate in same file
    const rotateMaxFiles = args.logFileDailyRotate ?? LOG_DAILY_ROTATE_DEFAULT;
    const filename = args.logFile ?? paths.defaultLogFilepath;
    const logFileLevel = args.logFileLevel ?? LOG_FILE_LEVEL_DEFAULT;

    transports.push(
      rotateMaxFiles > 0
        ? new DailyRotateFile({
            level: logFileLevel,
            //insert the date pattern in filename before the file extension.
            filename: filename.replace(/\.(?=[^.]*$)|$/, "-%DATE%$&"),
            datePattern: "YYYY-MM-DD",
            handleExceptions: true,
            maxFiles: rotateMaxFiles,
            auditFile: path.join(path.dirname(filename), ".log_rotate_audit.json"),
          })
        : new winston.transports.File({
            level: logFileLevel,
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
