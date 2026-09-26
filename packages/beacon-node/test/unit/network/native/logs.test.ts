import {describe, expect, it, vi} from "vitest";
import {NativeLogRecord} from "@chainsafe/lodestar-z/network";
import {LoggerNode, getNodeLogger} from "@lodestar/logger/node";
import {LogLevel} from "@lodestar/utils";
import {NativeLogs, nativeLogLevel} from "../../../../src/network/core/native/logs.js";

function record(sequence: number, level: NativeLogRecord["level"] = "debug"): NativeLogRecord {
  return {
    level,
    scope: "network_reqresp",
    message: "request_completed",
    sequence: BigInt(sequence),
    timestampMs: 1000n,
    monotonicMs: 20n,
    truncated: false,
  };
}

function fixture(level = LogLevel.debug) {
  const logger = {error: vi.fn(), warn: vi.fn(), info: vi.fn(), verbose: vi.fn(), debug: vi.fn()};
  const node = {...logger, toOpts: () => ({level}), child: vi.fn()} as unknown as LoggerNode;
  return {logs: new NativeLogs(node), logger};
}

describe("native log delivery", () => {
  it("logs each record at its level with its native context", () => {
    const f = fixture();
    f.logs.deliver([record(1), record(2, "warn")], null);
    expect(f.logger.debug).toHaveBeenCalledExactlyOnceWith("request_completed", {
      nativeScope: "network_reqresp",
      nativeSequence: "1",
      nativeTimestampMs: "1000",
      nativeMonotonicMs: "20",
      nativeTruncated: false,
    });
    expect(f.logger.warn).toHaveBeenCalledExactlyOnceWith(
      "request_completed",
      expect.objectContaining({nativeSequence: "2"})
    );
  });

  it("warns once per delivery that reports lost records, after the records", () => {
    const f = fixture();
    f.logs.deliver([record(1)], {dropped: 1n, suppressed: 7n, truncated: 0n});
    expect(f.logger.warn).toHaveBeenCalledExactlyOnceWith("Native log records limited", {
      dropped: "1",
      suppressed: "7",
      truncated: "0",
    });
    expect(f.logger.debug.mock.invocationCallOrder[0]).toBeLessThan(f.logger.warn.mock.invocationCallOrder[0]);
    f.logs.deliver([], null);
    expect(f.logger.warn).toHaveBeenCalledOnce();
  });

  it("lets a throwing logger fail the delivery, which the binding counts", () => {
    const f = fixture();
    f.logger.debug.mockImplementation(() => {
      throw Error("logger unavailable");
    });
    expect(() => f.logs.deliver([record(1)], null)).toThrow("logger unavailable");
  });
});

describe("native log level", () => {
  it.each([
    [LogLevel.error, "error"],
    [LogLevel.warn, "warn"],
    [LogLevel.info, "info"],
    [LogLevel.verbose, "info"],
    [LogLevel.debug, "debug"],
    [LogLevel.trace, "debug"],
  ] as const)("keeps records a %s console prints: %s", (level, native) => {
    expect(nativeLogLevel({level})).toBe(native);
  });

  it("selects the native module's console level, as the console transport does, from the logger", () => {
    const logger = (levelModule: Record<string, LogLevel>) =>
      getNodeLogger({level: LogLevel.info, levelModule}).child({module: "network"}).child({module: "native"});
    expect(new NativeLogs(logger({})).level).toBe("info");
    expect(new NativeLogs(logger({"network/native": LogLevel.debug})).level).toBe("debug");
    expect(new NativeLogs(logger({"network/native": LogLevel.warn})).level).toBe("warn");
    // The console transport applies a parent module's level only to that module's own records
    expect(new NativeLogs(logger({network: LogLevel.debug})).level).toBe("info");
  });

  it("selects a file level lower than the console's", () => {
    const file = (level: LogLevel) => ({filepath: "beacon.log", level});
    expect(nativeLogLevel({level: LogLevel.warn, file: file(LogLevel.debug)})).toBe("debug");
    expect(nativeLogLevel({level: LogLevel.debug, file: file(LogLevel.error)})).toBe("debug");
    expect(
      nativeLogLevel({level: LogLevel.error, module: "network/native", levelModule: {"network/native": LogLevel.info}})
    ).toBe("info");
  });
});
