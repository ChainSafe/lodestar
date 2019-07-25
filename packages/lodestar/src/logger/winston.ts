/**
 * @module logger
 */

import {createLogger, format, Logger, transports} from 'winston';
import {AbstractLogger, LogLevel, Module} from "./abstract";
import {ILoggingOptions} from "./interface";

export class WinstonLogger extends AbstractLogger {

  private winston: Logger;
  private loggingOptions: ILoggingOptions;

  public constructor(loggingOptions?: ILoggingOptions ) {
    super();
    // this.loggingOptions = loggingOptions;
    // if (!this.loggingOptions) {
    //   this.loggingOptions = {
    //     loggingLevel: LogLevel.DEFAULT,
    //     module: Module.DEFAULT,
    //   };
    // }

    this.winston = createLogger({
      level: LogLevel.INFO,
      transports: [
        new transports.Console({
          format: format.combine(
            format.colorize(),
            format.timestamp({
              format: 'YYYY-MM-DD HH:mm:ss'
            }),
            format.printf(
              info => `${info.timestamp} ${info.level}: ${info.message}`
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

  public silent(silent: boolean): void {
    this.winston.silent = silent;
  }

}
