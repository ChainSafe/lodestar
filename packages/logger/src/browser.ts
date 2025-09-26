import pino from "pino";
import {LodestarError, isEmptyObject} from "@lodestar/utils";
import {LogLevel, Logger, TimestampFormat, TimestampFormatCode} from "./interface.js";
import {PinoLogger} from "./pino.js";
import {logCtxToString} from "./utils/json.js";
import {formatEpochSlotTime} from "./utils/timeFormat.js";

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
  const levelToPinoLevel: Record<LogLevel, string> = {
    [LogLevel.error]: "error",
    [LogLevel.warn]: "warn",
    [LogLevel.info]: "info",
    [LogLevel.verbose]: "debug",
    [LogLevel.debug]: "debug",
    [LogLevel.trace]: "trace",
  };

  const module = opts.module || "";

  // Browser-specific pino configuration
  // biome-ignore lint/suspicious/noExplicitAny: Pino browser API requires any
  const browserWrite = (o: any) => {
    const logMethod = getConsoleMethod(o.level);
    let output: string;

    if (opts.format === "json") {
      // For JSON format, output the full object
      output = JSON.stringify(o);
    } else {
      // For human format, create a readable string
      output = formatLogMessage(o, opts.timestampFormat);
    }

    // biome-ignore lint/suspicious/noExplicitAny: Console methods are dynamic
    (console as any)[logMethod](output);
  };

  const pinoOptions = {
    browser: {
      write: browserWrite,
      serialize: opts.format === "json",
      asObject: true,
    },
    level: levelToPinoLevel[opts.level],
    base: {module},
    formatters: {
      level: (label: string) => ({level: label}),
    },
  };

  const pinoLogger = pino(pinoOptions);
  return new PinoLogger(pinoLogger);
}

function getConsoleMethod(level: number | string): string {
  // Map pino levels to console methods
  const levelStr = typeof level === "string" ? level : getLevelName(level);

  switch (levelStr) {
    case "error":
    case "fatal":
      return "error";
    case "warn":
      return "warn";
    case "info":
      return "info";
    default:
      return "log";
  }
}

function getLevelName(level: number): string {
  // Pino level numbers
  if (level === 10) return "trace";
  if (level === 20) return "debug";
  if (level === 30) return "info";
  if (level === 40) return "warn";
  if (level === 50) return "error";
  if (level === 60) return "fatal";
  return "info";
}

// biome-ignore lint/suspicious/noExplicitAny: Pino log object type
function formatLogMessage(log: any, timestampFormat?: TimestampFormat): string {
  const module = log.module || "";
  const paddingBetweenInfo = 30;
  const infoPad = paddingBetweenInfo - module.length;

  let str = "";

  // Add timestamp if needed
  if (timestampFormat?.format !== TimestampFormatCode.Hidden) {
    if (timestampFormat?.format === TimestampFormatCode.EpochSlot) {
      str += formatEpochSlotTime(timestampFormat) + " ";
    } else {
      const date = new Date();
      const month = (date.getMonth() + 1).toString().padStart(2, "0");
      const day = date.getDate().toString().padStart(2, "0");
      const hours = date.getHours().toString().padStart(2, "0");
      const minutes = date.getMinutes().toString().padStart(2, "0");
      const seconds = date.getSeconds().toString().padStart(2, "0");
      const ms = date.getMilliseconds().toString().padStart(3, "0");
      str += `${month}-${day} ${hours}:${minutes}:${seconds}.${ms} `;
    }
  }

  if (module) {
    str += `[${module}]`;
  }

  const levelName = typeof log.level === "string" ? log.level : getLevelName(log.level);
  str += ` ${levelName.padStart(infoPad)}: ${log.msg || ""}`;

  // Add context if present
  if (log.context && !isEmptyObject(log.context)) {
    str += " " + logCtxToString(log.context);
  }

  // Add error if present
  if (log.error) {
    const error = log.error;
    if (error instanceof LodestarError) {
      str += (isEmptyObject(log.context) ? " " : ", ") + logCtxToString(error);
    } else if (error instanceof Error) {
      str += " - " + error.message;
      if (error.stack) str += "\n" + error.stack;
    } else {
      str += " - " + logCtxToString(error);
    }
  }

  return str;
}
