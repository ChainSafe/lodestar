import {LogLevel} from "@lodestar/utils";

export * from "./interface.js";

export function getEnvLogLevel(): LogLevel | null {
  if (process == null) return null;
  if (process.env["LOG_LEVEL"]) return process.env["LOG_LEVEL"] as LogLevel;
  if (process.env["DEBUG"]) return LogLevel.debug;
  if (process.env["VERBOSE"]) return LogLevel.verbose;
  return null;
}
