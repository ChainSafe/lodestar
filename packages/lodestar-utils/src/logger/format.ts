import {format} from "winston";
import {toJson} from "../json";
import {Context, ILoggerOptions} from "./interface";
import {serializeContext} from "./serialize";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function humanReadableTemplateFn(_info: {[key: string]: any; level: string; message: string}): string {
  const info = _info as IWinstonInfoArg;

  const paddingBetweenInfo = 30;

  const infoString = info.module || info.namespace || "";
  const infoPad = paddingBetweenInfo - infoString.length;

  const logParts: (string | undefined)[] = [
    info.timestamp,
    `[${infoString.toUpperCase()}]`,
    `${info.level.padStart(infoPad)}:`,
    info.message,
    serializeContext(info.context),
    info.durationMs && ` - duration=${info.durationMs}ms`,
  ];

  return logParts.filter((s) => s).join(" ");
}
