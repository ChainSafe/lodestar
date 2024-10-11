import path from "node:path";
import fs from "node:fs";
import {ChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {LogFormat, TimestampFormatCode, logFormats} from "@lodestar/logger";
import {LoggerNodeOpts} from "@lodestar/logger/node";
import {LogLevel} from "@lodestar/utils";
import {LogArgs} from "../options/logOptions.js";
import {GlobalArgs} from "../options/globalOptions.js";

export const LOG_FILE_DISABLE_KEYWORD = "none";

/**
 * Setup a CLI logger, common for beacon, validator and dev commands
 */
export function parseLoggerArgs(
  args: LogArgs & Pick<GlobalArgs, "dataDir">,
  paths: {defaultLogFilepath: string},
  config: ChainForkConfig,
  opts?: {hideTimestamp?: boolean}
): LoggerNodeOpts {
  return {
    level: parseLogLevel(args.logLevel),
    file:
      args.logFile === LOG_FILE_DISABLE_KEYWORD
        ? undefined
        : {
            filepath: args.logFile ?? paths.defaultLogFilepath,
            level: parseLogLevel(args.logFileLevel),
            dailyRotate: args.logFileDailyRotate,
          },
    module: args.logPrefix,
    format: args.logFormat ? parseLogFormat(args.logFormat) : undefined,
    levelModule: args.logLevelModule && parseLogLevelModule(args.logLevelModule),
    timestampFormat: opts?.hideTimestamp
      ? {format: TimestampFormatCode.Hidden}
      : args.logFormatGenesisTime !== undefined
        ? {
            format: TimestampFormatCode.EpochSlot,
            genesisTime: args.logFormatGenesisTime,
            secondsPerSlot: config.SECONDS_PER_SLOT,
            slotsPerEpoch: SLOTS_PER_EPOCH,
          }
        : {
            format: TimestampFormatCode.DateRegular,
          },
  };
}

function parseLogFormat(format: string): LogFormat {
  if (!logFormats.includes(format as LogFormat)) {
    throw Error(`Unknown log format ${format}`);
  }
  return format as LogFormat;
}

function parseLogLevel(level: string): LogLevel {
  if (LogLevel[level as LogLevel] === undefined) {
    throw Error(`Unknown log level '${level}'`);
  }
  return level as LogLevel;
}

function parseLogLevelModule(logLevelModuleArr: string[]): Record<string, LogLevel> {
  const levelModule: Record<string, LogLevel> = {};
  for (const logLevelModule of logLevelModuleArr) {
    const [module, levelStr] = logLevelModule.split("=");
    levelModule[module] = parseLogLevel(levelStr);
  }
  return levelModule;
}

/**
 * Winston is not able to clean old log files if server is offline for a while
 * so we have to do this manually when starting the node.
 * See https://github.com/ChainSafe/lodestar/issues/4419
 */
export function cleanOldLogFiles(args: LogArgs, paths: {defaultLogFilepath: string}): void {
  const filepath = args.logFile ?? paths.defaultLogFilepath;
  const folder = path.dirname(filepath);
  const filename = path.basename(filepath);
  const lastIndexDot = filename.lastIndexOf(".");
  const prefix = filename.substring(0, lastIndexDot);
  const extension = filename.substring(lastIndexDot + 1, filename.length);
  const toDelete = fs
    .readdirSync(folder, {withFileTypes: true})
    .filter((de) => de.isFile())
    .map((de) => de.name)
    .filter((logFileName) => shouldDeleteLogFile(prefix, extension, logFileName, args.logFileDailyRotate))
    .map((logFileName) => path.join(folder, logFileName));
  // delete files
  for (const filename of toDelete) {
    fs.unlinkSync(filename);
  }
}

export function shouldDeleteLogFile(prefix: string, extension: string, logFileName: string, maxFiles: number): boolean {
  const maxDifferenceMs = maxFiles * 24 * 60 * 60 * 1000;
  const match = logFileName.match(new RegExp(`${prefix}-([0-9]{4}-[0-9]{2}-[0-9]{2}).${extension}`));
  // if match[1] exists, it should be the date pattern of YYYY-MM-DD
  if (match?.[1] && Date.now() - new Date(match[1]).getTime() > maxDifferenceMs) {
    return true;
  }
  return false;
}
