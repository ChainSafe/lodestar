import winston from "winston";
import {logCtxToJson, logCtxToString, LogData} from "./json.js";
import {ILoggerOptions, TimestampFormatCode} from "./interface.js";
import {formatEpochSlotTime} from "./util.js";

const {format} = winston;

type Format = ReturnType<typeof winston.format.combine>;

// TODO: Find a more typesafe way of enforce this properties
interface IWinstonInfoArg {
  level: string;
  message: string;
  module?: string;
  namespace?: string;
  timestamp: string;
  context: LogData;
  error: Error;
}

export function getFormat(opts: ILoggerOptions): Format {
  switch (opts.format) {
    case "json":
      return jsonLogFormat(opts);

    case "human":
    default:
      return humanReadableLogFormat(opts);
  }
}

function humanReadableLogFormat(opts: ILoggerOptions): Format {
  return format.combine(
    ...(opts.hideTimestamp ? [] : [formatTimestamp(opts)]),
    format.colorize(),
    format.printf(humanReadableTemplateFn)
  );
}

function formatTimestamp(opts: ILoggerOptions): Format {
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
    default:
      return format.timestamp({format: "MMM-DD HH:mm:ss.SSS"});
  }
}

function jsonLogFormat(opts: ILoggerOptions): Format {
  return format.combine(
    ...(opts.hideTimestamp ? [] : [format.timestamp()]),
    // eslint-disable-next-line @typescript-eslint/naming-convention
    format((_info) => {
      const info = _info as IWinstonInfoArg;
      info.context = logCtxToJson(info.context);
      info.error = (logCtxToJson(info.error) as unknown) as Error;
      return info;
    })(),
    format.json()
  );
}

/**
 * Winston template function print a human readable string given a log object
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/naming-convention
function humanReadableTemplateFn(_info: {[key: string]: any; level: string; message: string}): string {
  const info = _info as IWinstonInfoArg;

  const paddingBetweenInfo = 30;

  const infoString = info.module || info.namespace || "";
  const infoPad = paddingBetweenInfo - infoString.length;

  let str = "";

  if (info.timestamp) str += info.timestamp;

  str += `[${infoString.toUpperCase()}] ${info.level.padStart(infoPad)}: ${info.message}`;

  if (info.context !== undefined) str += " " + logCtxToString(info.context);
  if (info.error !== undefined) str += " " + logCtxToString(info.error);

  return str;
}
