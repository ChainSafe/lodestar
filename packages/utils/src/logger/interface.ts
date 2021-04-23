/**
 * @module logger
 */

import {Writable} from "stream";

export enum LogLevel {
  error = "error",
  warn = "warn",
  info = "info",
  verbose = "verbose",
  debug = "debug",
  silly = "silly",
}

export const logLevelNum: {[K in LogLevel]: number} = {
  [LogLevel.error]: 0,
  [LogLevel.warn]: 1,
  [LogLevel.info]: 2,
  [LogLevel.verbose]: 3,
  [LogLevel.debug]: 4,
  [LogLevel.silly]: 5,
};

// eslint-disable-next-line @typescript-eslint/naming-convention
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

export type LogFormat = "human" | "json";
export const logFormats: LogFormat[] = ["human", "json"];

export type EpochSlotOpts = {
  genesisTime: number;
  secondsPerSlot: number;
  slotsPerEpoch: number;
};
export enum TimestampFormatCode {
  DateRegular,
  EpochSlot,
}
export type TimestampFormat =
  | {format: TimestampFormatCode.DateRegular}
  | ({format: TimestampFormatCode.EpochSlot} & EpochSlotOpts);

export interface ILoggerOptions {
  level?: LogLevel;
  module?: string;
  format?: LogFormat;
  hideTimestamp?: boolean;
  timestampFormat?: TimestampFormat;
}

export type Context =
  | string
  | number
  | boolean
  | bigint
  | null
  | {
      [property: string]: Context;
    }
  | Context[];

export type LogHandler = (message: string, context?: Context, error?: Error) => void;

export interface ILogger {
  error: LogHandler;
  warn: LogHandler;
  info: LogHandler;
  important: LogHandler;
  verbose: LogHandler;
  debug: LogHandler;
  silly: LogHandler;
  profile(message: string, option?: {level: string; message: string}): void;
  stream(): Writable;
  // custom
  child(options: ILoggerOptions): ILogger;
}
