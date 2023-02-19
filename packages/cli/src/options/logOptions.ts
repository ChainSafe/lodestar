import {logFormats, LogLevels} from "@lodestar/utils";
import {CliCommandOptions} from "../util/command.js";
import {
  LogArgs,
  LOG_DAILY_ROTATE_DEFAULT,
  LOG_FILE_DISABLE_KEYWORD,
  LOG_FILE_LEVEL_DEFAULT,
  LOG_LEVEL_DEFAULT,
} from "../util/logger.js";

export const logOptions: CliCommandOptions<LogArgs> = {
  logLevel: {
    choices: LogLevels,
    description: "Logging verbosity level for emittings logs to terminal",
    default: LOG_LEVEL_DEFAULT,
    type: "string",
  },

  logFile: {
    description: `Path to output all logs to a persistent log file, use '${LOG_FILE_DISABLE_KEYWORD}' to disable`,
    type: "string",
  },

  logFileLevel: {
    choices: LogLevels,
    description: "Logging verbosity level for emittings logs to file",
    default: LOG_FILE_LEVEL_DEFAULT,
    type: "string",
  },

  logFileDailyRotate: {
    description:
      "Daily rotate log files, set to an integer to limit the file count, set to 0(zero) to disable rotation",
    default: LOG_DAILY_ROTATE_DEFAULT,
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
    coerce: (args: string[]) => args.map((item) => item.split(",")).flat(1),
  },
};
