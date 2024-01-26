import {describe, it, expect} from "vitest";
import {ExtendedPromise, ExtendedPromiseStatus, defaultAbortReason, resolveOrRacePromises} from "../../src/promise.js";
import {NonEmptyArray} from "../../src/types.js";

describe("promise", () => {
  describe("PromiseWithStatus", () => {
    it("should resolve to value for a resolved promise", async () => {
      const pro = ExtendedPromise.from(Promise.resolve("my value"));
      await expect(pro).resolves.toBe("my value");
    });

    it("should have initial status to pending", async () => {
      const pro = ExtendedPromise.from(Promise.resolve("my value"));
      expect(pro.status).toBe("pending");
    });

    it("should throw error for rejected promise", async () => {
      const pro = ExtendedPromise.from(Promise.reject("test error"));
      await expect(pro).rejects.toThrow("test error");
    });

    it("should have rejected status for rejected promise", async () => {
      const pro = ExtendedPromise.from(Promise.reject("test error"));

      await expect(pro).rejects.toBeDefined();

      expect(pro.status).toBe("rejected");
    });

    it("should have rejected error as reason for the promise object", async () => {
      const error = new Error("test error");
      const pro = ExtendedPromise.from(Promise.reject(error));

      await expect(pro).rejects.toBeDefined();

      expect(pro.reason).toBe(error);
    });

    it("should have correct durationMs attribute for promise which is resolved", async () => {
      const pro = new ExtendedPromise((resolve) => {
        setTimeout(() => {
          resolve("Resolved Value");
        }, 100);
      });

      await expect(pro).resolves.toBeDefined();
      expect(pro.durationMs).toBeGreaterThanOrEqual(100);
      // Some margin for execution
      expect(pro.durationMs).toBeLessThanOrEqual(110);
    });

    it("should have correct durationMs attribute for promise which is rejected", async () => {
      const pro = new ExtendedPromise((_, reject) => {
        setTimeout(() => {
          reject("Rejected Value");
        }, 100);
      });

      await expect(pro).rejects.toBeDefined();

      expect(pro.durationMs).toBeGreaterThanOrEqual(100);
      // Some margin for execution
      expect(pro.durationMs).toBeLessThanOrEqual(110);
    });

    it("should be able to abort promise from internal signal", async () => {
      const pro = new ExtendedPromise((resolve, reject) => {
        setTimeout(() => {
          resolve("Resolved Value");
        }, 200);

        setTimeout(() => {
          reject("Rejected Value");
        }, 400);
      });

      setTimeout(() => {
        pro.abort("My Aborted Reason");
      }, 100);

      await expect(pro).rejects.toThrow("My Aborted Reason");
      expect(pro.status).toBe(ExtendedPromiseStatus.Aborted);
      expect(pro.durationMs).toBeGreaterThanOrEqual(100);
      expect(pro.durationMs).toBeLessThanOrEqual(110);
    });

    it("should be able to abort promise from external signal", async () => {
      const controller = new AbortController();
      const pro = new ExtendedPromise((resolve, reject) => {
        setTimeout(() => {
          resolve("Resolved Value");
        }, 200);

        setTimeout(() => {
          reject("Rejected Value");
        }, 400);
      }, controller.signal);

      setTimeout(() => {
        controller.abort();
      }, 100);

      await expect(pro).rejects.toThrow(defaultAbortReason);
      expect(pro.status).toBe(ExtendedPromiseStatus.Aborted);
      expect(pro.durationMs).toBeGreaterThanOrEqual(100);
      expect(pro.durationMs).toBeLessThanOrEqual(110);
    });

    it("should not throw error if aborted twice", async () => {
      const controller = new AbortController();
      const pro = new ExtendedPromise((resolve, reject) => {
        setTimeout(() => {
          resolve("Resolved Value");
        }, 200);

        setTimeout(() => {
          reject("Rejected Value");
        }, 400);
      }, controller.signal);

      setTimeout(() => {
        controller.abort();
        pro.abort("My Aborted Reason");
      }, 100);

      await expect(pro).rejects.toThrow(defaultAbortReason);
      expect(pro.status).toBe(ExtendedPromiseStatus.Aborted);
      expect(pro.durationMs).toBeGreaterThanOrEqual(100);
      expect(pro.durationMs).toBeLessThanOrEqual(110);
    });
  });

  describe("resolveOrRacePromises", () => {
    const cutoffMs = 1000;
    const timeoutMs = 1500;

    const resolveAfter = (value: string, delay: number): ExtendedPromise<string> =>
      new ExtendedPromise((resolve) => {
        setTimeout(() => resolve(value), delay);
      });
    const rejectAfter = (value: string, delay: number): ExtendedPromise<string> =>
      new ExtendedPromise((_resolve, reject) => {
        setTimeout(() => reject(Error(value)), delay);
      });

    const testCases: [string, number[], (string | Error)[]][] = [
      ["all resolve pre-cutoff", [100, 200], ["100", "200"]],
      ["all resolve/reject pre-cutoff", [100, -200], ["100", "-200"]],
      ["all reject pre-cutoff", [-100, -200], ["-100", "-200"]],
      ["all reject pre-timeout", [-1100, -1200], ["-1100", "-1200"]],
      ["race and resolve pre-timeout", [1100, 1200], ["1100", "pending"]],
      ["race and resolve/reject pre-timeout", [-1100, 1200, 1300], ["-1100", "1200", "pending"]],
      [
        "some resolve pre-cutoff with no race post cutoff",
        [100, -200, -1100, 1200],
        ["100", "-200", "pending", "pending"],
      ],
      [
        "some reject pre-cutoff, with race resolution pre-timeout",
        [-100, -200, -1100, 1100, 1200],
        ["-100", "-200", "-1100", "1100", "pending"],
      ],
      [
        "some reject pre-cutoff, rest reject pre-timeout",
        [-100, -200, -1100, -1200],
        ["-100", "-200", "-1100", "-1200"],
      ],
      [
        "some resolve/reject pre-cutoff, some resolve/reject pre-timeout but no race beyond cutoff",
        [100, -200, -1100, 1100, 1700, -1700],
        ["100", "-200", "pending", "pending", "pending", "pending"],
      ],
      [
        "none resolve/reject pre-cutoff with race resolution pre timeout",
        [-1100, 1200, 1700],
        ["-1100", "1200", "pending"],
      ],
      ["none resolve pre-cutoff with race resolution pre timeout", [1100, 1200, 1700], ["1100", "pending", "pending"]],
      [
        "some reject pre-cutoff, some reject pre-timeout, but no resolution till timeout",
        [-100, -1100, -1200, 1700, -1800],
        ["-100", "-1100", "-1200", "pending", "pending"],
      ],
      ["none resolve/reject pre timeout", [1600, -1700], ["pending", "pending"]],
    ];

    for (const [name, timeouts, results] of testCases) {
      it(name, async () => {
        const testPromises = timeouts.map((timeMs) => {
          if (timeMs > 0) {
            return resolveAfter(`${timeMs}`, timeMs);
          } else {
            return rejectAfter(`${timeMs}`, -timeMs);
          }
        });
        const testResults = await resolveOrRacePromises(testPromises as NonEmptyArray<ExtendedPromise<string>>, {
          resolveTimeoutMs: cutoffMs,
          raceTimeoutMs: timeoutMs,
        });
        const testResultsCmp = testResults.map((r) => {
          switch ((r as ExtendedPromise<string>).status) {
            case ExtendedPromiseStatus.Fulfilled:
              return (r as ExtendedPromise<string>).value;
            case ExtendedPromiseStatus.Rejected:
            case ExtendedPromiseStatus.Aborted:
              return ((r as ExtendedPromise<string>).reason as Error).message;
            case ExtendedPromiseStatus.Pending:
              return "pending";
          }
        });
        expect(testResultsCmp).toEqual(results);
      });
    }
  });
});
