import {AbstractLogger, LogLevel} from "./interface";
import {createLogger, Logger, transports, format} from 'winston';

class WinstonLogger extends AbstractLogger {

  private winston: Logger;

  public constructor() {
    super();
    this.winston = createLogger({
      level: LogLevel.INFO,
      transports: [
        new transports.Console({
          format: format.combine(
            format.colorize(),
            format.timestamp({
              format: 'YYYY-MM-DD HH:mm:ss'
            }),
            format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
          ),
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

const logger = new WinstonLogger();

export default logger;
