/**
 * @module logger
 */

import {createLogger, format, Logger, transports} from 'winston';
import {AbstractLogger, LogLevel, Module} from "./abstract";

export class WinstonLogger extends AbstractLogger {

  private winston: Logger;
  private loggingModule;
  private loggingLevel;

  public constructor(loggingLevel: LogLevel = LogLevel.DEFAULT, loggingModule: Module = Module.DEFAULT ) {
    super();
    this.loggingModule = loggingModule;
    this.loggingLevel = loggingLevel;

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
              info => {
                return `${info.timestamp} [${this.loggingModule.toUpperCase()}] ${info.level}: ${info.message}`;
              }

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

  public createLogEntry(level: LogLevel, message: string | object, context: object = {}): void {
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
