/**
 * @module logger
 */


import {LogLevel} from "./abstract";


export interface ILogger {
  info(message: string|object, context?: object): void;
  warn(message: string|object, context?: object): void;
  error(message: string|object, context?: object): void;
  debug(message: string|object, context?: object): void;

  /**
   * Should change which log levels are recorded.
   * @param level
   */
  setLogLevel(level: LogLevel): void;

  /**
   * Disables all logging. Setting it to true is same as setting {@link setLogLevel}
   * with {@link LogLevel.NONE}
   * @param silent
   */

  silent(silent: boolean): void;

}