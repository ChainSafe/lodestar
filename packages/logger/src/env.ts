import {Logger} from "@lodestar/utils";
import {LogLevel} from "@lodestar/utils";
import {BrowserLoggerOpts, getBrowserLogger} from "./browser.js";
import {getEmptyLogger} from "./empty.js";
import {LogFormat, TimestampFormat} from "./interface.js";

export function getEnvLogLevel(): LogLevel | null {
  if (process == null) return null;
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL as LogLevel;
  if (process.env.DEBUG) return LogLevel.debug;
  if (process.env.VERBOSE) return LogLevel.verbose;
  return null;
}

export function getEnvLogger(opts?: Partial<BrowserLoggerOpts>): Logger {
  const level = opts?.level ?? getEnvLogLevel();
  const format = (opts?.format ?? process.env.LOG_FORMAT) as LogFormat;
  const timestampFormat =
    opts?.timestampFormat ??
    ((process.env.LOG_TIMESTAMP_FORMAT ? {format: process.env.LOG_TIMESTAMP_FORMAT} : undefined) as TimestampFormat);

  if (level != null) {
    return getBrowserLogger({...opts, level, format, timestampFormat});
  }

  return getEmptyLogger();
}
