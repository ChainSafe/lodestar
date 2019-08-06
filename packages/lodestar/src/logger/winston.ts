/**
 * @module logger
 */

import {createLogger, format, Logger, transports} from 'winston';
import {LogLevel, ILogger, ILoggerOptions} from "./interface";

export class WinstonLogger implements ILogger {
  private winston: Logger;

  public constructor(options?: Partial<ILoggerOptions>) {
    options = {
      level: LogLevel.DEFAULT,
      module: "",
      ...options
    };
    this.winston = createLogger({
      level: options.level,
      defaultMeta: {
        module: options.module,
      },
      transports: [
        new transports.Console({
          format: format.combine(
            format.colorize(),
            format.timestamp({
              format: 'YYYY-MM-DD HH:mm:ss'
            }),
            format.printf(
              info => `${info.timestamp} [${info.module.toUpperCase()}] ${info.level}: ${info.message}`
            )
          ),
          handleExceptions: true
        }),
      ],
      exitOnError: false
    });
  }

  public debug(message: string | object, context?: object): void {
    this.createLogEntry(LogLevel.DEBUG, message, context);
  }

  public error(message: string | object, context?: object): void {
    this.createLogEntry(LogLevel.ERROR, message, context);
  }

  public info(message: string | object, context?: object): void {
    this.createLogEntry(LogLevel.INFO, message, context);
  }

  public warn(message: string | object, context?: object): void {
    this.createLogEntry(LogLevel.WARN, message, context);
  }

  private createLogEntry(level: LogLevel, message: string | object, context: object = {}): void {
    if (typeof message === 'object') {
      this.winston.log(level, JSON.stringify(message));
    } else {
      this.winston.log(level, message, context);
    }
  }

  public set level(level: LogLevel) {
    this.winston.level = level;
  }
  public get level(): LogLevel {
    return this.winston.level as LogLevel;
  }

  public set silent(silent: boolean) {
    this.winston.silent = silent;
  }
  public get silent(): boolean {
    return this.winston.silent;
  }
}
