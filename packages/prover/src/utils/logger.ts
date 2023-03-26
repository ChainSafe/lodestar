import {LogData, Logger, LoggerChildOpts} from "@lodestar/utils";
import {ELRequestPayload} from "../types.js";

const printLogData = (data: LogData): string => {
  if (!Array.isArray(data) && data !== null && typeof data === "object") {
    return Object.entries(data)
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");
  }
  return JSON.stringify(data);
};

const stdLogHandler = (level: string): ((message: string, context?: LogData, error?: Error | undefined) => void) => {
  if (process === undefined) {
    return (message: string, context?: LogData, error?: Error | undefined): void => {
      // eslint-disable-next-line no-console
      console.log(
        `${level}: ${message} ${context === undefined ? "" : printLogData(context)} ${error ? error.stack : ""}`
      );
    };
  }
  return (message: string, context?: LogData, error?: Error | undefined): void => {
    const stream = level === "error" ? process.stderr : process.stdout;
    stream.write(
      `${level}: ${message} ${context === undefined ? "" : printLogData(context)} ${error ? error.stack : ""}\n`
    );
  };
};

export const stdLogger: Logger = {
  error: stdLogHandler("error"),
  warn: stdLogHandler("warn"),
  info: stdLogHandler("info"),
  debug: stdLogHandler("debug"),
  verbose: stdLogHandler("verb"),
  // eslint-disable-next-line func-names
  child: function (_options: LoggerChildOpts): Logger {
    throw new Error("Not supported.");
  },
};

export function logRequest({logger, payload}: {logger: Logger; payload: ELRequestPayload}): void {
  logger.debug(
    `Req method=${payload.method} params=${payload.params === undefined ? "" : JSON.stringify(payload.params)}`
  );
}
