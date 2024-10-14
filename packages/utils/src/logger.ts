/**
 * Interface of a generic Lodestar logger. For implementations, see `@lodestar/logger`
 */
export type Logger = Record<Exclude<LogLevel, LogLevel.trace>, LogHandler>;

export enum LogLevel {
  error = "error",
  warn = "warn",
  info = "info",
  verbose = "verbose",
  debug = "debug",
  trace = "trace",
}

export const LogLevels = Object.values(LogLevel);

export type LogHandler = (message: string, context?: LogData, error?: Error) => void;

export type LogDataBasic = string | number | bigint | boolean | null | undefined;
export type LogData = LogDataBasic | Record<string, LogDataBasic> | LogDataBasic[] | Record<string, LogDataBasic>[];
