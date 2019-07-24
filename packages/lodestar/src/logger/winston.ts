/**
 * @module logger
 */

import {createLogger, format, Logger, transports} from 'winston';
import {AbstractLogger, LogLevel, Module} from "./abstract";
import {ILoggingOptions} from "./interface";

export class WinstonLogger extends AbstractLogger {

  private winston: Logger;
  private loggingModule;
  private loggingLevel;

  public constructor(loggingOptions?: ILoggingOptions ) {
    super();

    if (!loggingOptions) {
      this.loggingModule = Module.DEFAULT;
      this.loggingLevel = LogLevel.DEFAULT;
    }
    else {
      this.loggingModule = loggingOptions.loggingModule;
      this.loggingLevel = loggingOptions.loggingLevel;
    }

    this.winston = createLogger({
      level: this.loggingLevel,
      transports: [
        new transports.Console({
          format: format.combine(
            format.colorize(),
            format.timestamp({
              format: 'YYYY-MM-DD HH:mm:ss'
            }),
            format.printf(
              info => `${info.timestamp} ${this.loggingModule} ${info.level}: ${info.message}`
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

  public setLogLevel(level: LogLevel): void {
    this.winston.level = level;
  }

  public setLoggingModule(loggingModule: Module): void{
    this.loggingModule = loggingModule;
  }

  public silent(silent: boolean): void {
    this.winston.silent = silent;
  }

}
