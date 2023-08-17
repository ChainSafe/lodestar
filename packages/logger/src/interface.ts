// eslint-disable-next-line import/no-extraneous-dependencies
import {LEVEL, MESSAGE} from "triple-beam";
import {LogLevel, Logger, LogHandler, LogData} from "@lodestar/utils";

export {LogLevel, Logger, LogHandler, LogData, LEVEL, MESSAGE};

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

export type LogFormat = "human" | "json";
export const logFormats: LogFormat[] = ["human", "json"];

export type EpochSlotOpts = {
  genesisTime: number;
  secondsPerSlot: number;
  slotsPerEpoch: number;
};
export enum TimestampFormatCode {
  DateRegular = "regular",
  Hidden = "hidden",
  EpochSlot = "epoch",
}
export type TimestampFormat =
  | {format: TimestampFormatCode.DateRegular}
  | {format: TimestampFormatCode.Hidden}
  | ({format: TimestampFormatCode.EpochSlot} & EpochSlotOpts);

export interface LoggerOptions {
  level?: LogLevel;
  module?: string;
  format?: LogFormat;
  timestampFormat?: TimestampFormat;
}

export interface WinstonLogInfo {
  module: string;
  [LEVEL]: LogLevel;
  [MESSAGE]: string;
}
