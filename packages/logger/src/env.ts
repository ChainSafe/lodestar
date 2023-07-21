import {Logger} from "@lodestar/utils";
import {LogLevel} from "@lodestar/utils";
import {BrowserLoggerOpts, getBrowserLogger} from "./browser.js";
import {getEmptyLogger} from "./empty.js";

export function getEnvLogLevel(): LogLevel | null {
  if (process == null) return null;
  if (process.env["LOG_LEVEL"]) return process.env["LOG_LEVEL"] as LogLevel;
  if (process.env["DEBUG"]) return LogLevel.debug;
  if (process.env["VERBOSE"]) return LogLevel.verbose;
  return null;
}

export function getEnvLogger(opts?: Partial<BrowserLoggerOpts>): Logger {
  const level = opts?.level ?? getEnvLogLevel();

  if (level != null) {
    return getBrowserLogger({...opts, level});
  }

  return getEmptyLogger();
}
