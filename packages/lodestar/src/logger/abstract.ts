/**
 * @module logger
 */


import {ILogger} from "./interface";

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  NONE = 'none',
  DEFAULT = 'info'
}

export enum Module {
  CHAIN = 'chain',
  NETWORK = 'network',
  DATABASE = 'database',
  ETH1 = 'eth1',
  SYNC = 'sync',
  VALIDATOR = 'validator',
  DEFAULT = '',
}

export abstract class AbstractLogger implements ILogger{

  public abstract info(message: string|object, context?: object): void;
  public abstract warn(message: string|object, context?: object): void;
  public abstract error(message: string|object, context?: object): void;
  public abstract debug(message: string|object, context?: object): void;

  /**
   * Should change which log levels are recorded.
   * @param level
   */
  public abstract setLogLevel(level: LogLevel): void;

  /**
   * Disables all logging. Setting it to true is same as setting {@link setLogLevel}
   * with {@link LogLevel.NONE}
   * @param silent
   */
  public abstract silent(silent: boolean): void;

}
