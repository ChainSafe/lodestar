import winston from "winston";
import Transport from "winston-transport";
import {LogLevel, Logger} from "@lodestar/utils";
import {createWinstonLogger} from "./winston.js";
import {LEVEL, MESSAGE, TimestampFormat, WinstonLogInfo} from "./interface.js";

export type BrowserLoggerOpts = {
  /**
   * Module prefix for all logs
   */
  module?: string;
  level: LogLevel;
  /**
   * Rendering format for logs, defaults to "human"
   */
  format?: "human" | "json";
  /**
   * Enables relative to genesis timestamp format
   * ```
   * timestampFormat = {
   *   format: TimestampFormatCode.EpochSlot,
   *   genesisTime: args.logFormatGenesisTime,
   *   secondsPerSlot: config.SECONDS_PER_SLOT,
   *   slotsPerEpoch: SLOTS_PER_EPOCH,
   * }
   * ```
   */
  timestampFormat?: TimestampFormat;
};

export function getBrowserLogger(opts: BrowserLoggerOpts): Logger {
  return createWinstonLogger(
    {level: opts.level, module: opts.module ?? "", format: opts.format, timestampFormat: opts.timestampFormat},
    [new BrowserConsole({level: opts.level})]
  );
}

class BrowserConsole extends Transport {
  name = "BrowserConsole";
  private levels: Record<LogLevel, number> = {
    error: 0,
    warn: 1,
    info: 2,
    verbose: 3,
    debug: 4,
    trace: 5,
  };

  private methods: Record<LogLevel, string> = {
    error: "error",
    warn: "warn",
    info: "info",
    verbose: "log",
    debug: "log",
    trace: "log",
  };

  constructor(opts: winston.transport.TransportStreamOptions | undefined) {
    super(opts);
    this.level = opts?.level && this.levels.hasOwnProperty(opts.level) ? opts.level : "info";
  }

  log(info: WinstonLogInfo, callback: () => void): void {
    setTimeout(() => {
      this.emit("logged", info);
    }, 0);

    const val = this.levels[info[LEVEL]];
    const mappedMethod = this.methods[info[LEVEL]];
    const message = info[MESSAGE];

    if (val <= this.levels[this.level as LogLevel]) {
      // @ts-expect-error
      console[mappedMethod](message);
    }

    callback();
  }
}
