import fs from "node:fs";
import path from "node:path";
import tmp from "tmp";
import {getEnvLogLevel} from "@lodestar/logger/env";
import {LoggerNode, LoggerNodeOpts, getNodeLogger} from "@lodestar/logger/node";
import {LogLevel} from "@lodestar/utils";

export const networkDev = "dev";

const tmpDir = tmp.dirSync({unsafeCleanup: true});
export const testFilesDir = tmpDir.name;

export type TestLoggerOpts = LoggerNodeOpts;

/**
 * Run the test with ENVs to control log level:
 * ```
 * LOG_LEVEL=debug vitest .ts
 * DEBUG=1 vitest .ts
 * VERBOSE=1 vitest .ts
 * ```
 */
export const testLogger = (module?: string, opts?: TestLoggerOpts): LoggerNode => {
  if (opts == null) {
    opts = {} as LoggerNodeOpts;
  }
  if (module) {
    opts.module = module;
  }
  const level = getEnvLogLevel();
  opts.level = level ?? LogLevel.info;
  return getNodeLogger(opts);
};

export function getTestdirPath(filepath: string): string {
  const fullpath = path.join(testFilesDir, filepath);
  fs.mkdirSync(path.dirname(fullpath), {recursive: true});
  return fullpath;
}

export function isNullish<T = unknown>(value: T | undefined | null): value is undefined | null {
  return value === undefined || value === null;
}
