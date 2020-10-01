import {format} from "winston";
import {toJson} from "../json";
import {Context} from "./interface";
import {serializeContext} from "./serialize";

interface IFormatOptions {
  hideTimestamp?: boolean;
}

type Format = ReturnType<typeof format.combine>;

export function humanReadableLogFormat(opts: IFormatOptions): Format {
  return format.combine(
    ...(opts.hideTimestamp ? [] : [format.timestamp({format: "YYYY-MM-DD HH:mm:ss"})]),
    format.colorize(),
    format.printf(humanReadableTemplateFn)
  );
}

export function jsonLogFormat(opts: IFormatOptions): Format {
  return format.combine(
    ...(opts.hideTimestamp ? [] : [format.timestamp()]),
    format((info) => {
      info.context = toJson(info.context);
      return info;
    })(),
    format.json()
  );
}

export const defaultLogFormat = humanReadableLogFormat;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function humanReadableTemplateFn(_info: {[key: string]: any; level: string; message: string}): string {
  const info = _info as {
    level: string;
    message: string;
    module?: string;
    namespace?: string;
    timestamp?: string;
    durationMs?: string;
    context: Context | Error;
  };

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
