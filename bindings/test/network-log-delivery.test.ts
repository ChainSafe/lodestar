import {afterEach, describe, expect, it, vi} from "vitest";
import type {NativeLogRecord} from "../src/network.js";
import {LOG_DRAIN_ERRORS_NAME, LOG_ERRORS_NAME, LOG_MS, LOG_RECORDS, LogDelivery} from "../src/network-log-delivery.js";
import type {NativeLogBatch} from "../src/network-types.js";

const noLogs: NativeLogBatch = {more: false, records: []};

function fixture() {
  const runtime = {drainLogs: vi.fn((_max: number): NativeLogBatch => noLogs)};
  const host = {
    error: vi.fn((_error: unknown): void => undefined),
    logs: vi.fn((_records: readonly NativeLogRecord[]): void => undefined),
  };
  const logs = new LogDelivery(runtime, host, host.error);
  logs.start();
  return {host, logs, runtime};
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function logRecord(sequence: number): NativeLogRecord {
  return {
    level: "info",
    message: `record ${sequence}`,
    scope: "network_runtime",
    timestampMs: 1,
  };
}

describe("native log delivery", () => {
  it("delivers up to 256 native records every 100 ms, one batch each time", () => {
    vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
    const node = fixture();
    const records = [logRecord(1), logRecord(2)];
    node.runtime.drainLogs.mockReturnValue({...noLogs, more: true, records});
    vi.advanceTimersByTime(LOG_MS - 1);
    expect(node.runtime.drainLogs).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(node.runtime.drainLogs).toHaveBeenCalledExactlyOnceWith(LOG_RECORDS);
    expect(node.host.logs).toHaveBeenCalledExactlyOnceWith(records);
    vi.advanceTimersByTime(LOG_MS);
    expect(node.host.logs).toHaveBeenCalledTimes(2);
    // An empty batch is not delivered.
    node.runtime.drainLogs.mockReturnValue(noLogs);
    vi.advanceTimersByTime(LOG_MS);
    expect(node.host.logs).toHaveBeenCalledTimes(2);
  });

  it("counts undelivered records separately from failed drains", () => {
    vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
    const node = fixture();
    node.runtime.drainLogs.mockReturnValue({...noLogs, records: [logRecord(1), logRecord(2)]});
    node.host.logs.mockImplementation(() => {
      throw new Error("logger failed");
    });
    vi.advanceTimersByTime(LOG_MS);
    const failure = new Error("drain failed");
    node.runtime.drainLogs.mockImplementationOnce(() => {
      throw failure;
    });
    vi.advanceTimersByTime(LOG_MS);
    vi.advanceTimersByTime(LOG_MS);
    expect(node.host.logs).toHaveBeenCalledTimes(2);
    expect(node.logs.metrics()).toContain(`${LOG_ERRORS_NAME} 4\n`);
    expect(node.host.error).toHaveBeenCalledExactlyOnceWith(failure);
    expect(node.logs.metrics()).toContain(`${LOG_DRAIN_ERRORS_NAME} 1\n`);
  });

  it("drains at most eight final batches, then stops", () => {
    vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
    const node = fixture();
    node.runtime.drainLogs.mockReturnValue({...noLogs, more: true, records: [logRecord(1)]});
    node.logs.stop();
    expect(node.host.logs).toHaveBeenCalledTimes(8);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10 * LOG_MS);
    expect(node.host.logs).toHaveBeenCalledTimes(8);
  });
});
