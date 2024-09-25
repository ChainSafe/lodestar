import winston, {format} from "winston";
import {LodestarError, isEmptyObject} from "@lodestar/utils";
import {LoggerOptions, TimestampFormatCode} from "../interface.js";
import {logCtxToJson, logCtxToString, LogData} from "./json.js";
import {formatEpochSlotTime} from "./timeFormat.js";

type Format = ReturnType<typeof winston.format.combine>;

// TODO: Find a more typesafe way of enforce this properties
type WinstonInfoArg = {
  level: string;
  message: string;
  module?: string;
  namespace?: string;
  timestamp: string;
  context: LogData;
  error: Error;
};

export function getFormat(opts: LoggerOptions): Format {
  switch (opts.format) {
    case "json":
      return jsonLogFormat(opts);
    case "human":
      return humanReadableLogFormat(opts);
    default:
      return humanReadableLogFormat(opts);
  }
}

function humanReadableLogFormat(opts: LoggerOptions): Format {
  return format.combine(
    ...(opts.timestampFormat?.format === TimestampFormatCode.Hidden ? [] : [formatTimestamp(opts)]),
    format.colorize(),
    format.printf(humanReadableTemplateFn)
  );
}

function formatTimestamp(opts: LoggerOptions): Format {
  const {timestampFormat} = opts;

  switch (timestampFormat?.format) {
    case TimestampFormatCode.EpochSlot:
      return {
        transform: (info) => {
          info.timestamp = formatEpochSlotTime(timestampFormat);
          return info;
        },
      };

    case TimestampFormatCode.DateRegular:
      return format.timestamp({format: "MMM-DD HH:mm:ss.SSS"});
    default:
      return format.timestamp({format: "MMM-DD HH:mm:ss.SSS"});
  }
}

function jsonLogFormat(opts: LoggerOptions): Format {
  return format.combine(
    ...(opts.timestampFormat?.format === TimestampFormatCode.Hidden ? [] : [format.timestamp()]),
    format((_info) => {
      const info = _info as WinstonInfoArg;
      info.context = logCtxToJson(info.context);
      info.error = logCtxToJson(info.error) as unknown as Error;
      return info;
    })(),
    format.json()
  );
}

/**
 * Winston template function print a human readable string given a log object
 */

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
function humanReadableTemplateFn(_info: {[key: string]: any; level: string; message: string}): string {
  const info = _info as WinstonInfoArg;

  const paddingBetweenInfo = 30;

  const infoString = info.module || info.namespace || "";
  const infoPad = paddingBetweenInfo - infoString.length;

  let str = "";

  if (info.timestamp) str += info.timestamp;

  str += `[${infoString}] ${info.level.padStart(infoPad)}: ${info.message}`;

  if (info.context !== undefined && !isEmptyObject(info.context)) str += " " + logCtxToString(info.context);
  if (info.error !== undefined) {
    str +=
      // LodestarError is formatted in the same way as context, it is either appended to
      // the log message (" ") or extends existing context properties (", "). For any other
      // error, the message is printed out and clearly separated from the log message (" - ").
      (info.error instanceof LodestarError ? (isEmptyObject(info.context) ? " " : ", ") : " - ") +
      logCtxToString(info.error);
  }

  return str;
}
