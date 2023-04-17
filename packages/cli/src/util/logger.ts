import path from "node:path";
import fs from "node:fs";
import DailyRotateFile from "winston-daily-rotate-file";
import TransportStream from "winston-transport";
import winston from "winston";
import {ChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  Logger,
  LogLevel,
  createWinstonLogger,
  TimestampFormat,
  TimestampFormatCode,
  LogFormat,
  logFormats,
} from "@lodestar/utils";
import {GlobalArgs} from "../options/globalOptions.js";
import {ConsoleDynamicLevel} from "./loggerConsoleTransport.js";

export const LOG_FILE_DISABLE_KEYWORD = "none";
export const LOG_LEVEL_DEFAULT = LogLevel.info;
export const LOG_FILE_LEVEL_DEFAULT = LogLevel.debug;
export const LOG_DAILY_ROTATE_DEFAULT = 5;
const DATE_PATTERN = "YYYY-MM-DD";

export type LogArgs = {
  logLevel?: LogLevel;
  logFile?: string;
  logFileLevel?: LogLevel;
  logFileDailyRotate?: number;
  logFormatGenesisTime?: number;
  logPrefix?: string;
  logFormat?: string;
  logLevelModule?: string[];
};

/**
 * Setup a CLI logger, common for beacon, validator and dev commands
 */
export function getCliLogger(
  args: LogArgs & Pick<GlobalArgs, "dataDir">,
  paths: {defaultLogFilepath: string},
  config: ChainForkConfig,
  opts?: {hideTimestamp?: boolean}
): {logger: Logger; logParams: {filename: string; rotateMaxFiles: number}} {
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
  if (args.logFile !== LOG_FILE_DISABLE_KEYWORD) {
    const logFileLevel = args.logFileLevel ?? LOG_FILE_LEVEL_DEFAULT;

    transports.push(
      rotateMaxFiles > 0
        ? new DailyRotateFile({
            level: logFileLevel,
            //insert the date pattern in filename before the file extension.
            filename: filename.replace(/\.(?=[^.]*$)|$/, "-%DATE%$&"),
            datePattern: DATE_PATTERN,
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

  const logger = createWinstonLogger(
    {
      module: args.logPrefix,
      format: args.logFormat ? parseLogFormat(args.logFormat) : "human",
      timestampFormat,
      hideTimestamp: opts?.hideTimestamp,
    },
    transports
  );

  return {logger, logParams: {filename, rotateMaxFiles}};
}

/**
 * Winston is not able to clean old log files if server is offline for a while
 * so we have to do this manually when starting the node.
 * See https://github.com/ChainSafe/lodestar/issues/4419
 */
export function cleanOldLogFiles(filePath: string, maxFiles: number): void {
  const folder = path.dirname(filePath);
  const filename = path.basename(filePath);
  const lastIndexDot = filename.lastIndexOf(".");
  const prefix = filename.substring(0, lastIndexDot);
  const extension = filename.substring(lastIndexDot + 1, filename.length);
  const toDelete = fs
    .readdirSync(folder, {withFileTypes: true})
    .filter((de) => de.isFile())
    .map((de) => de.name)
    .filter((logFileName) => shouldDeleteLogFile(prefix, extension, logFileName, maxFiles))
    .map((logFileName) => path.join(folder, logFileName));
  // delete files
  toDelete.forEach((filename) => fs.unlinkSync(filename));
}

export function shouldDeleteLogFile(prefix: string, extension: string, logFileName: string, maxFiles: number): boolean {
  const maxDifferenceMs = maxFiles * 24 * 60 * 60 * 1000;
  const match = logFileName.match(new RegExp(`${prefix}-([0-9]{4}-[0-9]{2}-[0-9]{2}).${extension}`));
  // if match[1] exists, it should be the date pattern of YYYY-MM-DD
  if (match && match[1] && Date.now() - new Date(match[1]).getTime() > maxDifferenceMs) {
    return true;
  }
  return false;
}

function parseLogFormat(format: string): LogFormat {
  if (!logFormats.includes(format as LogFormat)) {
    throw Error(`Invalid log format '${format}'`);
  }

  return format as LogFormat;
}
