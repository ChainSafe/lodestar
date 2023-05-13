import {LogLevel} from "@lodestar/utils";
import {getEnvLogger, LoggerEnvOpts} from "@lodestar/logger";
export {LogLevel};

export type TestLoggerOpts = LoggerEnvOpts;

/**
 * Run the test with ENVs to control log level:
 * ```
 * LOG_LEVEL=debug mocha .ts
 * DEBUG=1 mocha .ts
 * VERBOSE=1 mocha .ts
 * ```
 */
export const testLogger = getEnvLogger;
