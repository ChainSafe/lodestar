import {setImmediate as yieldToIO} from "node:timers/promises";
import {describe, expect, it} from "vitest";
import {defer} from "@lodestar/utils";
import {ApiError} from "../../../../src/api/impl/errors.js";
import {assertUniqueItems, forEachGossipSubmission} from "../../../../src/api/impl/utils.js";

describe("api / impl / utils", () => {
  it("bounds active gossip submissions without blocking later items on a slow validation", async () => {
    const blocked = defer<void>();
    const visited: number[] = [];
    let active = 0;
    let highWater = 0;
    const submitted = forEachGossipSubmission(
      Array.from({length: 300}, (_, index) => index),
      async (item, index) => {
        expect(item).toBe(index);
        visited.push(index);
        active++;
        highWater = Math.max(highWater, active);
        if (index === 0) await blocked.promise;
        else await Promise.resolve();
        active--;
      }
    );
    try {
      await yieldToIO();
      expect(visited).toHaveLength(300);
      expect(highWater).toBe(32);
      expect(active).toBe(1);
    } finally {
      blocked.resolve();
      await submitted;
    }
  });
  it("shares capacity across concurrent batches and hands released slots to waiting callers", async () => {
    const blocked = defer<void>();
    const first = defer<void>();
    const waiting = defer<void>();
    const calls: [number, number][] = [];
    let active = 0;
    let highWater = 0;
    const submissions = Array.from({length: 4}, (_, batch) =>
      forEachGossipSubmission(
        Array.from({length: 100}, (_, i) => i),
        async (item, index) => {
          expect(item).toBe(index);
          calls.push([batch, index]);
          active++;
          highWater = Math.max(highWater, active);
          if (batch === 0 && index === 0) await first.promise;
          else if (batch === 0) await blocked.promise;
          else await waiting.promise;
          active--;
        }
      )
    );
    try {
      expect(calls).toHaveLength(32);
      first.resolve();
      await yieldToIO();
      expect(calls.at(-1)).toEqual([1, 0]);
      expect(highWater).toBe(32);
    } finally {
      first.resolve();
      blocked.resolve();
      waiting.resolve();
      await Promise.all(submissions);
    }
    expect(highWater).toBe(32);
    expect(active).toBe(0);
    expect(new Set(calls.map(([batch, index]) => `${batch}:${index}`)).size).toBe(400);
  });

  it.each([false, true])("releases all capacity after submit throws (async: %s)", async (asyncFailure) => {
    const failure = new Error("publication failed");
    const fail = (): Promise<void> => {
      if (asyncFailure) return Promise.reject(failure);
      throw failure;
    };
    await expect(forEachGossipSubmission(Array.from({length: 32}), fail)).rejects.toBe(failure);

    const blocked = defer<void>();
    let started = 0;
    const submitted = forEachGossipSubmission(Array.from({length: 32}), async () => {
      started++;
      await blocked.promise;
    });
    try {
      await yieldToIO();
      expect(started).toBe(32);
    } finally {
      blocked.resolve();
      await submitted;
    }
  });
  describe("assertUniqueItems", () => {
    it("should not throw for undefined input", () => {
      expect(() => assertUniqueItems(undefined, "test message")).not.toThrow();
    });

    it("should not throw for empty array", () => {
      expect(() => assertUniqueItems([], "test message")).not.toThrow();
    });

    it("should not throw for array with unique values", () => {
      expect(() => assertUniqueItems([1, 2, 3], "test message")).not.toThrow();
      expect(() => assertUniqueItems(["a", "b", "c"], "test message")).not.toThrow();
      expect(() => assertUniqueItems([true, false], "test message")).not.toThrow();
    });

    it("should throw ApiError if array contains duplicate values", () => {
      expect(() => assertUniqueItems([1, 2, 1], "Duplicate values found")).toThrowError(ApiError);
    });

    it("should throw if array contains duplicate values and list duplicates", () => {
      const errorMessage = "Duplicate values found";
      const errorMessageFn = (duplicateItems: unknown[]) => `${errorMessage}: ${duplicateItems.join(", ")}`;

      expect(() => assertUniqueItems([1, 2, 1], errorMessage)).toThrow(errorMessageFn([1]));
      expect(() => assertUniqueItems([1, 2, 1, 2], errorMessage)).toThrow(errorMessageFn([1, 2]));
      expect(() => assertUniqueItems(["a", "b", "a"], errorMessage)).toThrow(errorMessageFn(["a"]));
      expect(() => assertUniqueItems([true, true], errorMessage)).toThrow(errorMessageFn([true]));
    });
  });
});
