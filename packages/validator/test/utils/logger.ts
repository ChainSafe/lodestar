import {getEnvLogger} from "@lodestar/logger/env";
import {getLoggerVc} from "../../src/util/index.js";
import {ClockMock} from "./clock.js";

/**
 * Run the test with ENVs to control log level:
 * ```
 * LOG_LEVEL=debug mocha .ts
 * DEBUG=1 mocha .ts
 * VERBOSE=1 mocha .ts
 * ```
 */
export const testLogger = getEnvLogger;

export const loggerVc = getLoggerVc(getEnvLogger(), new ClockMock());
