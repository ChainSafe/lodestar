import {LogData} from "./json.js";

export enum LogLevel {
  error = "error",
  warn = "warn",
  info = "info",
  verbose = "verbose",
  debug = "debug",
  trace = "trace",
}

export const logLevelNum: {[K in LogLevel]: number} = {
  [LogLevel.error]: 0,
  [LogLevel.warn]: 1,
  [LogLevel.info]: 2,
  [LogLevel.verbose]: 3,
  [LogLevel.debug]: 4,
  /** Request in https://github.com/ChainSafe/lodestar/issues/4536 by eth-docker */
  [LogLevel.trace]: 5,
};

// eslint-disable-next-line @typescript-eslint/naming-convention
export const LogLevels = Object.values(LogLevel);

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

export interface LoggerOptions {
  level?: LogLevel;
  module?: string;
  format?: LogFormat;
  hideTimestamp?: boolean;
  timestampFormat?: TimestampFormat;
}

export type LoggerChildOpts = {
  module: string;
};

export type LogHandler = (message: string, context?: LogData, error?: Error) => void;

export type Logger = {
  error: LogHandler;
  warn: LogHandler;
  info: LogHandler;
  verbose: LogHandler;
  debug: LogHandler;
  // custom
  child(options: LoggerChildOpts): Logger;
};
