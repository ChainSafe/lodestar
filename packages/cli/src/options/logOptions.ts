import {LogLevels, CliCommandOptions} from "@lodestar/utils";
import {LogLevel, logFormats} from "@lodestar/logger";
import {LOG_FILE_DISABLE_KEYWORD} from "../util/logger.js";

export type LogArgs = {
  logLevel: LogLevel;
  logFile?: string;
  logFileLevel: LogLevel;
  logFileDailyRotate: number;
  logFormatGenesisTime?: number;
  logPrefix?: string;
  logFormat?: string;
  logLevelModule?: string[];
};

export const logOptions: CliCommandOptions<LogArgs> = {
  logLevel: {
    choices: LogLevels,
    description: "Logging verbosity level for emitting logs to terminal",
    default: LogLevel.info,
    type: "string",
  },

  logFile: {
    description: `Path to output all logs to a persistent log file, use '${LOG_FILE_DISABLE_KEYWORD}' to disable`,
    type: "string",
  },

  logFileLevel: {
    choices: LogLevels,
    description: "Logging verbosity level for emitting logs to file",
    default: LogLevel.debug,
    type: "string",
  },

  logFileDailyRotate: {
    description:
      "Daily rotate log files, set to an integer to limit the file count, set to 0 (zero) to disable rotation",
    default: 5,
    type: "number",
  },

  logFormatGenesisTime: {
    hidden: true,
    description:
      "Use epoch slot timestamp format, instead or regular timestamp. Must provide genesisTime to compute relative time",
    type: "number",
  },

  logPrefix: {
    hidden: true,
    description: "Logger prefix module field with a string ID",
    type: "string",
  },

  logFormat: {
    hidden: true,
    description: "Log format used when emitting logs to the terminal and / or file",
    choices: logFormats,
    type: "string",
  },

  logLevelModule: {
    hidden: true,
    description: "Set log level for a specific module by name: 'chain=debug' or 'network=debug,chain=debug'",
    type: "array",
    string: true,
    coerce: (args: string[]) => args.flatMap((item) => item.split(",")),
  },
};
