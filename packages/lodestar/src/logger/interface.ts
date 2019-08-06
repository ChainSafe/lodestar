/**
 * @module logger
 */


export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  HTTP = 'http',
  VERBOSE = 'verbose',
  DEBUG = 'debug',
  SILLY = 'debug',
  NONE = 'none',
  DEFAULT = 'info'
}

export interface ILoggerOptions {
  level: LogLevel;
  module: string;
}

export interface ILogger {
  level: LogLevel;
  silent: boolean;

  info(message: string|object, context?: object): void;
  warn(message: string|object, context?: object): void;
  error(message: string|object, context?: object): void;
  debug(message: string|object, context?: object): void;
}
