import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {NativeLogBatch, NativeLogRecord} from "@chainsafe/lodestar-z/network";
import {NativeLogs} from "../../../../src/network/core/native/logs.js";

beforeEach(() => vi.useFakeTimers({now: 100000}));
afterEach(() => vi.useRealTimers());

function fixture() {
  let queued: NativeLogRecord[] = [];
  let suppressed = 0n;
  let dropped = 0n;
  const logger = {error: vi.fn(), warn: vi.fn(), info: vi.fn(), verbose: vi.fn(), debug: vi.fn()};
  const runtime = {
    setLogLevel: vi.fn(),
    drainLogs: vi.fn((max = 32): NativeLogBatch => {
      const records = queued.splice(0, max);
      return {records, more: queued.length > 0, dropped, suppressed, truncated: 0n};
    }),
  };
  const logs = new NativeLogs(runtime, logger);
  return {
    logs,
    runtime,
    logger,
    enqueue(count: number): void {
      queued = Array.from({length: count}, (_, i) => ({
        level: "debug",
        scope: "network_reqresp",
        message: "request_completed",
        sequence: BigInt(i + 1),
        timestampMs: 1000n,
        monotonicMs: 20n,
        truncated: false,
      }));
    },
    drop(count: bigint): void {
      dropped = count;
    },
    suppress(count: bigint): void {
      suppressed = count;
    },
  };
}

it("forwards structured native context through the normal logger and flushes a full queue on close", () => {
  const f = fixture();
  f.enqueue(1);
  vi.advanceTimersByTime(250);
  expect(f.runtime.setLogLevel).toHaveBeenCalledWith("debug");
  expect(f.logger.debug).toHaveBeenCalledWith("request_completed", {
    nativeScope: "network_reqresp",
    nativeSequence: "1",
    nativeTimestampMs: "1000",
    nativeMonotonicMs: "20",
    nativeTruncated: false,
  });
  f.enqueue(128);
  f.logs.close();
  expect(f.logger.debug).toHaveBeenCalledTimes(129);
  const calls = f.runtime.drainLogs.mock.calls.length;
  vi.advanceTimersByTime(10000);
  expect(f.runtime.drainLogs).toHaveBeenCalledTimes(calls);
  expect(vi.getTimerCount()).toBe(0);
});

it("isolates throwing loggers and reports cumulative native loss without flooding warnings", () => {
  const f = fixture();
  f.logger.debug.mockImplementation(() => {
    throw Error("logger unavailable");
  });
  f.enqueue(2);
  f.suppress(7n);
  f.drop(1n);
  expect(() => vi.advanceTimersByTime(250)).not.toThrow();
  // The second record is still delivered after the first one's logger threw
  expect(f.logger.debug).toHaveBeenCalledTimes(2);
  expect(f.logger.warn).toHaveBeenCalledOnce();
  expect(f.logger.warn).toHaveBeenCalledWith("Native log records limited", {
    dropped: "1",
    suppressed: "7",
    truncated: "0",
  });
  f.suppress(10n);
  vi.advanceTimersByTime(1000);
  expect(f.logger.warn).toHaveBeenCalledOnce();
  f.drop(2n);
  vi.advanceTimersByTime(30000);
  expect(f.logger.warn).toHaveBeenLastCalledWith("Native log records limited", {
    dropped: "1",
    suppressed: "3",
    truncated: "0",
  });
  f.logs.close();
});

it("contains native drain failures and still retires the polling timer", () => {
  const f = fixture();
  f.runtime.drainLogs.mockImplementation(() => {
    throw Error("allocation failed");
  });
  f.logger.warn.mockImplementation(() => {
    throw Error("logger unavailable");
  });
  expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
  expect(f.logger.warn).toHaveBeenCalledWith("Native log delivery failed", {}, expect.any(Error));
  expect(() => f.logs.close()).not.toThrow();
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps routine debug sampling out of warnings", () => {
  const f = fixture();
  f.suppress(100n);
  vi.advanceTimersByTime(31000);
  expect(f.logger.warn).not.toHaveBeenCalled();
  f.logs.close();
});
