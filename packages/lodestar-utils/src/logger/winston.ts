/**
 * @module logger
 */

import {createLogger, Logger, transports as winstonTransports} from "winston";
import {Context, defaultLogLevel, ILogger, ILoggerOptions, LogLevel} from "./interface";
import chalk from "chalk";
import {getFormat} from "./format";
import TransportStream from "winston-transport";
import {Writable} from "stream";

export const consoleTransport: TransportStream = new winstonTransports.Console({
  debugStdout: true,
  level: "silly",
  handleExceptions: true,
});

export const fileTransport = (filename: string): TransportStream => {
  return new winstonTransports.File({
    level: "silly",
    filename,
    handleExceptions: true,
  });
};

export class WinstonLogger implements ILogger {
  private winston: Logger;
  private _level: LogLevel;
  private _silent: boolean;

  constructor(options?: Partial<ILoggerOptions>, transports?: TransportStream[]) {
    options = {
      level: defaultLogLevel,
      module: "",
      ...options,
    };

    this.winston = createLogger({
      level: options.level, // log level switching handled in `createLogEntry`
      defaultMeta: {
        module: options.module || "",
      },
      format: getFormat(options),
      transports: transports || [consoleTransport],
      exitOnError: false,
    });
    this._level = options.level || LogLevel.info;
    this._silent = false;
    if (typeof process !== "undefined" && typeof process.env !== "undefined") {
      this._silent = process.env.LODESTAR_SILENCE === "true";
    }
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
    this.createLogEntry(LogLevel.info, chalk.red(message as string), context, error);
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

  set level(level: LogLevel) {
    this.winston.level = LogLevel[level];
    this._level = level;
  }

  get level(): LogLevel {
    return this._level;
  }

  set silent(silent: boolean) {
    this._silent = silent;
  }

  get silent(): boolean {
    return this._silent;
  }

  child(options: ILoggerOptions): WinstonLogger {
    const logger = Object.create(WinstonLogger.prototype);
    const winston = this.winston.child({namespace: options.module, level: options.level});
    //use more verbose log
    if (this.winston.levels[this._level] > this.winston.levels[options.level ?? LogLevel.error]) {
      winston.level = this._level;
    } else {
      winston.level = options.level ?? this._level;
    }
    return Object.assign(logger, {
      winston,
      _level: winston.level,
      _silent: this._silent,
    });
  }

  private createLogEntry(level: LogLevel, message: string, context?: Context, error?: Error): void {
    //don't propagate if silenced or message level is more detailed than logger level
    if (this.silent || this.winston.levels[level] > this.winston.levels[this._level]) {
      return;
    }
    this.winston[level](message, {context, error});
  }
}
