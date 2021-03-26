/**
 * @module logger
 */

import {createLogger, Logger} from "winston";
import {Context, defaultLogLevel, ILogger, ILoggerOptions, LogLevel} from "./interface";
import chalk from "chalk";
import {getFormat} from "./format";
import {Writable} from "stream";
import {TransportOpts, TransportType, fromTransportOpts} from "./transport";

const defaultTransportOpts: TransportOpts = {type: TransportType.console};

type DefaultMeta = {
  module: string;
};

export class WinstonLogger implements ILogger {
  private winston: Logger;
  private _level: LogLevel;
  private _options: Partial<ILoggerOptions>;
  private _transportOptsArr: TransportOpts[];

  constructor(options: Partial<ILoggerOptions> = {}, transportOptsArr: TransportOpts[] = [defaultTransportOpts]) {
    this.winston = createLogger({
      level: options?.level || defaultLogLevel,
      defaultMeta: {module: options?.module || ""} as DefaultMeta,
      format: getFormat(options || {}),
      transports: transportOptsArr.map(fromTransportOpts),
      exitOnError: false,
    });
    this._level = this.getMinLevel(transportOptsArr.map((opts) => opts.level || defaultLogLevel));
    // Store for child logger
    this._options = options;
    this._transportOptsArr = transportOptsArr;
  }

  error(message: string, context?: Context, error?: Error): void {
    this.createLogEntry(LogLevel.error, message, context, error);
  }

  warn(message: string, context?: Context, error?: Error): void {
    this.createLogEntry(LogLevel.warn, message, context, error);
  }

  info(message: string, context?: Context, error?: Error): void {
    this.createLogEntry(LogLevel.info, message, context, error);
  }

  important(message: string, context?: Context, error?: Error): void {
    this.createLogEntry(LogLevel.info, chalk.red(message), context, error);
  }

  verbose(message: string, context?: Context, error?: Error): void {
    this.createLogEntry(LogLevel.verbose, message, context, error);
  }

  debug(message: string, context?: Context, error?: Error): void {
    this.createLogEntry(LogLevel.debug, message, context, error);
  }

  silly(message: string, context?: Context, error?: Error): void {
    this.createLogEntry(LogLevel.silly, message, context, error);
  }

  profile(message: string, option?: {level: string; message: string}): void {
    this.winston.profile(message, option);
  }

  stream(): Writable {
    throw Error("Not implemented");
  }

  child(options: ILoggerOptions): WinstonLogger {
    // Concat module tags
    if (options.module) options.module = [this._options.module, options.module].filter(Boolean).join(" ");
    return new WinstonLogger({...this._options, ...options}, this._transportOptsArr);
  }

  private createLogEntry(level: LogLevel, message: string, context?: Context, error?: Error): void {
    // don't propagate if silenced or message level is more detailed than logger level
    if (this.winston.levels[level] > this.winston.levels[this._level]) {
      return;
    }
    this.winston[level](message, {context, error});
  }

  /** Return the min LogLevel from multiple transports */
  private getMinLevel(levels: LogLevel[]): LogLevel {
    return levels.reduce(
      // error: 0, warn: 1, info: 2, ...
      (minLevel, level) => (this.winston.levels[level] > this.winston.levels[minLevel] ? level : minLevel),
      defaultLogLevel
    );
  }
}
