import {Logger} from "@lodestar/logger";
import {Mocked, vi} from "vitest";

export type MockedLogger = Mocked<Logger>;

export function getMockedLogger(): MockedLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    verbose: vi.fn(),
  };
}
