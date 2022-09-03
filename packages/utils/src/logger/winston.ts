import winston from "winston";
import type {Logger} from "winston";
import chalk from "chalk";
import {defaultLogLevel, ILogger, ILoggerOptions, LogLevel} from "./interface.js";
import {getFormat} from "./format.js";
import {LogData} from "./json.js";

const {createLogger} = winston;

type DefaultMeta = {
  module: string;
};

export class WinstonLogger implements ILogger {
  private winston: Logger;

  constructor(
    private readonly options: Partial<ILoggerOptions> = {},
    private readonly transports?: winston.transport[]
  ) {
    this.winston = createLogger({
      level: options?.level || defaultLogLevel,
      defaultMeta: {module: options?.module || ""} as DefaultMeta,
      format: getFormat(options),
      transports,
      exitOnError: false,
    });
  }

  error(message: string, context?: LogData, error?: Error): void {
    this.createLogEntry(LogLevel.error, message, context, error);
  }

  warn(message: string, context?: LogData, error?: Error): void {
    this.createLogEntry(LogLevel.warn, message, context, error);
  }

  info(message: string, context?: LogData, error?: Error): void {
    this.createLogEntry(LogLevel.info, message, context, error);
  }

  important(message: string, context?: LogData, error?: Error): void {
    this.createLogEntry(LogLevel.info, chalk.red(message), context, error);
  }

  verbose(message: string, context?: LogData, error?: Error): void {
    this.createLogEntry(LogLevel.verbose, message, context, error);
  }

  debug(message: string, context?: LogData, error?: Error): void {
    this.createLogEntry(LogLevel.debug, message, context, error);
  }

  silly(message: string, context?: LogData, error?: Error): void {
    this.createLogEntry(LogLevel.silly, message, context, error);
  }

  child(options: ILoggerOptions): WinstonLogger {
    // Concat module tags
    if (options.module) options.module = [this.options.module, options.module].filter(Boolean).join(" ");
    return new WinstonLogger({...this.options, ...options}, this.transports);
  }

  private createLogEntry(level: LogLevel, message: string, context?: LogData, error?: Error): void {
    // don't propagate if silenced or message level is more detailed than logger level
    // if (logLevelNum[level] > logLevelNum[this._level]) {
    //   return;
    // }
    this.winston[level](message, {context, error});
  }
}
