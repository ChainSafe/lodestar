/**
 * Interface of a generic Lodestar logger. For implementations, see `@lodestar/logger`
 */
export type Logger = Record<LogLevel, LogHandler>;

export enum LogLevel {
  error = "error",
  warn = "warn",
  info = "info",
  verbose = "verbose",
  debug = "debug",
  trace = "trace",
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const LogLevels = Object.values(LogLevel);

export type LogHandler = (message: string, context?: LogData, error?: Error) => void;

type LogDataBasic = string | number | bigint | boolean | null | undefined;
export type LogData = LogDataBasic | Record<string, LogDataBasic> | LogDataBasic[] | Record<string, LogDataBasic>[];
