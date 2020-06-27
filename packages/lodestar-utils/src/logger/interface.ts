/**
 * @module logger
 */

import {ArrayLike} from "@chainsafe/ssz";
import {Writable} from "stream";

export enum LogLevel {
  error = "error",
  warn = "warn",
  info = "info",
  verbose = "verbose",
  debug = "debug",
  silly = "silly",
}

export const LogLevels = Object.values(LogLevel);


export const customColors = {
  error: "red",
  warn: "yellow",
  info: "white",
  verbose: "green",
  debug: "pink",
  silly: "purple",
};

export const defaultLogLevel = LogLevel.info;

export interface ILoggerOptions {
  level?: LogLevel;
  module?: string;
}

export type Context = {[k: string]: string|number|BigInt|ArrayLike<number>};

export interface ILogger {
  level: LogLevel;
  silent: boolean;

  error(message: string, context?: Context|Error): void;
  warn(message: string, context?: Context|Error): void;
  info(message: string, context?: Context): void;
  important(message: string, context?: Context): void;
  verbose(message: string, context?: Context): void;
  debug(message: string, context?: Context): void;
  silly(message: string, context?: Context): void;
  profile(message: string, option?: {level: string; message: string}): void;
  stream(): Writable;
  // custom
  child(options: ILoggerOptions): ILogger;
}
