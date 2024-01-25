import {getEnvLogger} from "@lodestar/logger/env";
import {getLoggerVc} from "../../src/util/index.js";
import {ClockMock} from "./clock.js";

/**
 * Run the test with ENVs to control log level:
 * ```
 * LOG_LEVEL=debug vitest .ts
 * DEBUG=1 vitest .ts
 * VERBOSE=1 vitest .ts
 * ```
 */
export const testLogger = getEnvLogger;

export const loggerVc = getLoggerVc(getEnvLogger(), new ClockMock());
