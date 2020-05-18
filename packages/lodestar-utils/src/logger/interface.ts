/**
 * @module logger
 */

export enum LogLevel {
  error = "error",
  warn = "warn",
  info = "info",
  verbose = "verbose",
  debug = "debug",
  silly = "silly",
}

// @ts-ignore
export const LogLevels = Object.keys(LogLevel).map(key => LogLevel[key]);


export const customColors = {
  error: "red",
  warn: "yellow",
  info: "white",
  verbose: "green",
  debug: "pink",
  silly: "purple",
};

export const defaultLogLevel = LogLevel.info;

export interface ILoggerOptions {
  level: LogLevel;
  module: string;
}

export interface ILogger {
  level: LogLevel;
  silent: boolean;

  error(message: string|object, context?: object): void;
  warn(message: string|object, context?: object): void;
  info(message: string|object, context?: object): void;
  verbose(message: string|object, context?: object): void;
  debug(message: string|object, context?: object): void;
  silly(message: string|object, context?: object): void;

  // custom
  child(options: ILoggerOptions): ILogger;
  important(message: string|object, context?: object): void;
}
