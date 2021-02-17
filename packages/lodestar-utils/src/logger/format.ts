import {Json} from "@chainsafe/ssz";
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
  context: Context;
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
    ...(opts.hideTimestamp ? [] : [format.timestamp({format: "YYYY-MM-DD HH:mm:ss"})]),
    format.colorize(),
    format.printf(humanReadableTemplateFn)
  );
}

function jsonLogFormat(opts: ILoggerOptions): Format {
  return format.combine(
    ...(opts.hideTimestamp ? [] : [format.timestamp()]),
    // eslint-disable-next-line @typescript-eslint/naming-convention
    format((_info) => {
      const info = _info as IWinstonInfoArg;
      info.context = toJson(info.context);
      info.error = (toJson(info.error) as unknown) as Error;
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

  const logParts: (string | undefined)[] = [
    info.timestamp,
    `[${infoString.toUpperCase()}]`,
    `${info.level.padStart(infoPad)}:`,
    info.message,
    info.context ? printStackTraceLast(info.context) : undefined,
    info.error ? printStackTraceLast(info.error) : undefined,
    info.durationMs && ` - duration=${info.durationMs}ms`,
  ];

  return logParts.filter((s) => s).join(" ");
}

/**
 * Extract stack property from context to allow appending at the end of the log
 */
export function printStackTraceLast(context?: Context | Error): string {
  if (!context) {
    return "";
  }

  const json = toJson(context);
  const stackTraces = extractStackTraceFromJson(json);

  if (stackTraces.length > 0) {
    return [toString(json), ...stackTraces].join("\n");
  } else {
    return toString(json);
  }
}

/**
 * Extract 'stack' from Json-ified error recursively.
 * Mutates the `json` argument deleting all 'stack' properties.
 * `json` argument must not contain circular properties, which should be guaranteed by `toJson()`
 */
export function extractStackTraceFromJson(json: Json, stackTraces: string[] = []): string[] {
  if (typeof json === "object" && json !== null && !Array.isArray(json)) {
    let stack: string | null = null;
    for (const [key, value] of Object.entries(json)) {
      if (key === "stack" && typeof value === "string") {
        stack = value;
        delete ((json as unknown) as Error)[key];
      } else {
        extractStackTraceFromJson(value as Json, stackTraces);
      }
    }
    // Push stack trace last so nested errors come first
    if (stack) stackTraces.push(stack);
  }
  return stackTraces;
}
