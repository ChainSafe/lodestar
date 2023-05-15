import {LogLevel} from "@lodestar/utils";
import {getNodeLogger, LoggerNode, LoggerNodeOpts} from "@lodestar/logger/node";
import {getEnvLogLevel} from "@lodestar/logger/env";
export {LogLevel};

export type TestLoggerOpts = LoggerNodeOpts;

/**
 * Run the test with ENVs to control log level:
 * ```
 * LOG_LEVEL=debug mocha .ts
 * DEBUG=1 mocha .ts
 * VERBOSE=1 mocha .ts
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
