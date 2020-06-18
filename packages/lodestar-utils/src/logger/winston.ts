/**
 * @module logger
 */

import {createLogger, Logger, transports as winstonTransports} from "winston";
import {Context, defaultLogLevel, ILogger, ILoggerOptions, LogLevel} from "./interface";
import chalk from "chalk";
import {defaultLogFormat} from "./format";
import TransportStream from "winston-transport";
import {Writable} from "stream";

export class WinstonLogger implements ILogger {
  private winston: Logger;
  private _level: LogLevel;
  private _silent: boolean;

  public constructor(options?: Partial<ILoggerOptions>, transports?: TransportStream) {
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
      format: defaultLogFormat,
      transports: transports || [
        new winstonTransports.Console({
          debugStdout: true,
          level: "silly",
          handleExceptions: true
        })
      ],
      exitOnError: false
    });
    this._level = options.level;
    this._silent = false;
    if (typeof process !== "undefined" && typeof process.env !== "undefined") {
      this._silent = process.env.LODESTAR_SILENCE === "true";
    }
  }

  public debug(message: string, context?: Context): void {
    this.createLogEntry(LogLevel.debug, message, context);
  }

  public info(message: string, context?: Context): void {
    this.createLogEntry(LogLevel.info, message, context);
  }

  public important(message: string, context?: Context): void {
    this.createLogEntry(LogLevel.info, chalk.red(message as string), context);
  }

  public error(message: string, context?: Context|Error): void {
    this.createLogEntry(LogLevel.error, message, context);
  }

  public warn(message: string, context?: Context|Error): void {
    this.createLogEntry(LogLevel.warn, message, context);
  }

  public verbose(message: string, context?: Context): void {
    this.createLogEntry(LogLevel.verbose, message, context);
  }

  public silly(message: string, context?: Context): void {
    this.createLogEntry(LogLevel.silly, message, context);
  }

  public profile(message: string, option?: {level: string; message: string}): void {
    this.winston.profile(message, option);
  }

  public stream(): Writable {
    return null;
  }

  public set level(level: LogLevel) {
    this.winston.level = LogLevel[level];
    this._level = level;
  }

  public get level(): LogLevel {
    return this._level;
  }

  public set silent(silent: boolean) {
    this._silent = silent;
  }

  public get silent(): boolean {
    return this._silent;
  }

  public child(options: ILoggerOptions): WinstonLogger {
    const logger = Object.create(WinstonLogger.prototype);
    const winston = this.winston.child({namespace: options.module, level: options.level});
    winston.level = options.level || this._level;
    return Object.assign(logger, {
      winston,
      _level: options.level || this._level,
      _silent: this._silent,
    });
  }

  private createLogEntry(level: LogLevel, message: string, context: Context|Error): void {
    if (this.silent || this.winston.levels[level] > this.winston.levels[this._level]) {
      return;
    }
    this.winston[level](message, {context});
  }

}
