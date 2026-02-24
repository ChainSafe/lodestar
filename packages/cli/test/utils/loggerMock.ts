import {Mocked, vi} from "vitest";
import {Logger} from "@lodestar/utils";

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
