import {format} from "winston";
import {toJson, toString} from "../json";
import {Context, ILoggerOptions} from "./interface";

type Format = ReturnType<typeof format.combine>;

// TODO: Find a more typesafe way of enforce this properties
interface IWinstonInfoArg {
  level: string;
  message: string;
  module?: string;
  namespace?: string;
  timestamp?: string;
  durationMs?: string;
  context: Context | Error;
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
    ...(opts.hideTimestamp ? [] : [format.timestamp({format: "YYYY-MM-DD HH:mm:ss"})]),
    format.colorize(),
    format.printf(humanReadableTemplateFn)
  );
}

function jsonLogFormat(opts: ILoggerOptions): Format {
  return format.combine(
    ...(opts.hideTimestamp ? [] : [format.timestamp()]),
    format((_info) => {
      const info = _info as IWinstonInfoArg;
      info.context = toJson(info.context);
      return info;
    })(),
    format.json()
  );
}

/**
 * Winston template function print a human readable string given a log object
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function humanReadableTemplateFn(_info: {[key: string]: any; level: string; message: string}): string {
  const info = _info as IWinstonInfoArg;

  const paddingBetweenInfo = 30;

  const infoString = info.module || info.namespace || "";
  const infoPad = paddingBetweenInfo - infoString.length;

  const {context, stack} = splitContextAndStackTrace(info.context);

  const logParts: (string | undefined)[] = [
    info.timestamp,
    `[${infoString.toUpperCase()}]`,
    `${info.level.padStart(infoPad)}:`,
    info.message,
    context,
    info.durationMs && ` - duration=${info.durationMs}ms`,
    stack && `\n${stack}`,
  ];

  return logParts.filter((s) => s).join(" ");
}

/**
 * Extract stack property from context to allow appending at the end of the log
 */
function splitContextAndStackTrace(context?: Context | Error): {context?: string; stack?: string} {
  if (!context) {
    return {};
  }

  const json = toJson(context);

  if (typeof json === "object" && json !== null && !Array.isArray(json) && json.stack) {
    const {stack, ...errJsonData} = json;
    return {context: toString(errJsonData), stack: toString(stack)};
  } else {
    return {context: toString(json)};
  }
}
