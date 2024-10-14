import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";
import {shouldDeleteLogFile} from "../../../src/util/logger.js";

describe("shouldDeleteLogFile", () => {
  const prefix = "beacon";
  const extension = "log";

  beforeEach(() => {
    vi.useFakeTimers({now: new Date("2023-01-01")});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllTimers();
  });
  const tcs: {logFile: string; maxFiles: number; now: number; result: boolean}[] = [
    // missing .log
    {
      logFile: "beacon-2022-12-25",
      maxFiles: 5,
      now: new Date("2023-01-01").getTime(),
      result: false,
    },
    // close to now
    {
      logFile: "beacon-2022-12-28.log",
      maxFiles: 5,
      now: new Date("2023-01-01").getTime(),
      result: false,
    },
    // incorrect date format
    {
      logFile: "beacon-20225-12-12.log",
      maxFiles: 5,
      now: new Date("2023-01-01").getTime(),
      result: false,
    },
    // maxFiles is 10 so close to now
    {
      logFile: "beacon-2022-12-25.log",
      maxFiles: 10,
      now: new Date("2023-01-01").getTime(),
      result: false,
    },
    {
      logFile: "beacon-2022-12-25.log",
      maxFiles: 5,
      now: new Date("2023-01-01").getTime(),
      result: true,
    },
  ];

  for (const {logFile, maxFiles, result} of tcs) {
    it(`should ${
      result ? "" : "not"
    } delete ${logFile}, maxFiles ${maxFiles}, today ${new Date().toUTCString()}`, () => {
      expect(shouldDeleteLogFile(prefix, extension, logFile, maxFiles)).toBe(result);
    });
  }
});
