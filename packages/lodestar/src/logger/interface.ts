/**
 * @module logger
 */

export enum LogLevel {
  error,
  warn,
  info,
  verbose,
  debug,
  silly,
}

export const LogLevels = [
  "error",
  "warn",
  "info",
  "verbose",
  "debug",
  "silly",
];

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
  level: typeof LogLevel[number];
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
