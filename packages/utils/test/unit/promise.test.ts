import {describe, it, expect} from "vitest";
import {ExtendedPromiseStatus, resolveOrRacePromises, ExtendedPromise} from "../../src/promise.js";
import {NonEmptyArray} from "../../src/types.js";
import {ErrorAborted, TimeoutError} from "../../src/errors.js";

describe("promise", () => {
  describe("PromiseWithStatus", () => {
    function expectResolvedValue(obj: unknown, val: unknown) {
      expect(obj).toEqual(
        expect.objectContaining({
          value: val,
          status: ExtendedPromiseStatus.Fulfilled,
          durationMs: expect.any(Number),
          startedAt: expect.any(Number),
          finishedAt: expect.any(Number),
        })
      );
    }

    function expectRejectedError(
      obj: unknown,
      val: unknown,
      status: ExtendedPromiseStatus = ExtendedPromiseStatus.Rejected
    ) {
      if (status === ExtendedPromiseStatus.Rejected) {
        expect(obj).toEqual(
          expect.objectContaining({
            status: status,
            durationMs: expect.any(Number),
            startedAt: expect.any(Number),
            finishedAt: expect.any(Number),
            reason: val,
          })
        );
      } else if (status === ExtendedPromiseStatus.Timeout) {
        expect(obj).toEqual(
          expect.objectContaining({
            status: status,
            durationMs: expect.any(Number),
            startedAt: expect.any(Number),
            finishedAt: expect.any(Number),
          })
        );
      }
    }

    it("should resolve to value for a resolved promise", async () => {
      const pro = ExtendedPromise.from(Promise.resolve("my value"));

      expectResolvedValue(await pro, "my value");
    });

    it("should have initial status to pending", async () => {
      const pro = ExtendedPromise.from(Promise.resolve("my value"));
      expect(pro.status).toBe(ExtendedPromiseStatus.Pending);
    });

    it("should throw error for rejected promise", async () => {
      const pro = ExtendedPromise.from(Promise.reject("test error"));
      expectRejectedError(await pro, "test error");
    });

    it("should have rejected status for rejected promise", async () => {
      const pro = ExtendedPromise.from(Promise.reject("test error"));

      expectRejectedError(await pro, "test error");

      expect(pro.status).toBe(ExtendedPromiseStatus.Rejected);
    });

    it("should have rejected error as reason for the promise object", async () => {
      const error = new Error("test error");
      const pro = ExtendedPromise.from(Promise.reject(error));

      expectRejectedError(await pro, error);
    });

    it("should have correct durationMs attribute for promise which is resolved", async () => {
      const pro = new ExtendedPromise((resolve) => {
        setTimeout(() => {
          resolve("Resolved Value");
        }, 100);
      });

      const res = await pro;
      expect(res.durationMs).toBeGreaterThanOrEqual(100);
      // Some margin for execution
      expect(res.durationMs).toBeLessThanOrEqual(130);
    });

    it("should have correct durationMs attribute for promise which is rejected", async () => {
      const pro = new ExtendedPromise((_, reject) => {
        setTimeout(() => {
          reject("Rejected Value");
        }, 100);
      });

      const res = await pro;

      expect(res.durationMs).toBeGreaterThanOrEqual(100);
      // Some margin for execution
      expect(res.durationMs).toBeLessThanOrEqual(130);
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

      const res = await pro;
      expectRejectedError(res, new ErrorAborted("My Aborted Reason"), ExtendedPromiseStatus.Aborted);

      expect(pro.status).toBe(ExtendedPromiseStatus.Aborted);
      expect(res.durationMs).toBeGreaterThanOrEqual(100);
      expect(res.durationMs).toBeLessThanOrEqual(130);
    });

    it("should be able to abort promise from external signal", async () => {
      const controller = new AbortController();
      const pro = new ExtendedPromise(
        (resolve, reject) => {
          setTimeout(() => {
            resolve("Resolved Value");
          }, 200);

          setTimeout(() => {
            reject("Rejected Value");
          }, 400);
        },
        {signal: controller.signal}
      );

      setTimeout(() => {
        controller.abort("My Aborted Reason");
      }, 100);

      const res = await pro;
      expectRejectedError(res, new ErrorAborted("My Aborted Reason"), ExtendedPromiseStatus.Aborted);

      expect(pro.status).toBe(ExtendedPromiseStatus.Aborted);
      expect(res.durationMs).toBeGreaterThanOrEqual(100);
      expect(res.durationMs).toBeLessThanOrEqual(130);
    });

    it("should not throw error if aborted twice", async () => {
      const controller = new AbortController();
      const pro = new ExtendedPromise(
        (resolve, reject) => {
          setTimeout(() => {
            resolve("Resolved Value");
          }, 200);

          setTimeout(() => {
            reject("Rejected Value");
          }, 400);
        },
        {signal: controller.signal}
      );

      setTimeout(() => {
        controller.abort("My Aborted Reason 1");
        pro.abort("My Aborted Reason 2");
      }, 100);

      const res = await pro;
      expectRejectedError(res, new ErrorAborted("My Aborted Reason 1"), ExtendedPromiseStatus.Aborted);

      expect(pro.status).toBe(ExtendedPromiseStatus.Aborted);
      expect(res.durationMs).toBeGreaterThanOrEqual(100);
      expect(res.durationMs).toBeLessThanOrEqual(130);
    });

    it("should be able abort using timeout signal", async () => {
      const pro = new ExtendedPromise((resolve, reject) => {
        setTimeout(() => {
          resolve("Resolved Value");
        }, 200);

        setTimeout(() => {
          reject("Rejected Value");
        }, 400);
      });

      setTimeout(() => {
        pro.timeout("I am timeout");
      }, 100);

      const res = await pro;
      expectRejectedError(res, new TimeoutError("My Aborted Reason"), ExtendedPromiseStatus.Timeout);

      expect(pro.status).toBe(ExtendedPromiseStatus.Timeout);
      expect(res.durationMs).toBeGreaterThanOrEqual(100);
      expect(res.durationMs).toBeLessThanOrEqual(130);
    });
  });

  describe("resolveOrRacePromises", () => {
    const cutoffMs = 1000;
    const timeoutMs = 1500;

    const resolveAfter = (value: string, delay: number): Promise<string> =>
      new Promise((resolve) => {
        setTimeout(() => resolve(value), delay);
      });

    const rejectAfter = (value: string, delay: number): Promise<string> =>
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(Error(value)), delay);
      });

    const testCases: [string, number[], (string | Error)[]][] = [
      ["all resolve pre-cutoff", [100, 200], ["100", "200"]],
      ["all resolve/reject pre-cutoff", [100, -200], ["100", "-200"]],
      ["all reject pre-cutoff", [-100, -200], ["-100", "-200"]],
      ["all reject pre-timeout", [-1100, -1200], ["-1100", "-1200"]],
      ["race and resolve pre-timeout", [1100, 1200], ["1100", "aborted"]],
      ["race and resolve/reject pre-timeout", [-1100, 1200, 1300], ["-1100", "1200", "aborted"]],
      [
        "some resolve pre-cutoff with no race post cutoff",
        [100, -200, -1100, 1200],
        ["100", "-200", "-1100", "1200"],
      ],
      [
        "some reject pre-cutoff, with race resolution pre-timeout",
        [-100, -200, -1100, 1100, 1200],
        ["-100", "-200", "-1100", "1100", "aborted"],
      ],
      [
        "some reject pre-cutoff, rest reject pre-timeout",
        [-100, -200, -1100, -1200],
        ["-100", "-200", "-1100", "-1200"],
      ],
      [
        "some resolve/reject pre-cutoff, some resolve/reject pre-timeout but no race beyond cutoff",
        [100, -200, -1100, 1100, 1700, -1700],
        ["100", "-200", "-1100", "1100", "aborted", "aborted"],
      ],
      [
        "none resolve/reject pre-cutoff with race resolution pre timeout",
        [-1100, 1200, 1700],
        ["-1100", "1200", "aborted"],
      ],
      ["none resolve pre-cutoff with race resolution pre timeout", [1100, 1200, 1700], ["1100", "aborted", "aborted"]],
      [
        "some reject pre-cutoff, some reject pre-timeout, but no resolution till timeout",
        [-100, -1100, -1200, 1700, -1800],
        ["-100", "-1100", "-1200", "timeout", "timeout"],
      ],
      ["none resolve/reject pre timeout", [1600, -1700], ["timeout", "timeout"]],
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
        const testResults = await resolveOrRacePromises(testPromises as unknown as NonEmptyArray<ExtendedPromise<string>>, {
          resolveTimeoutMs: cutoffMs,
          raceTimeoutMs: timeoutMs,
        });
        const testResultsCmp = testResults.map((r) => {
          switch (r.status) {
            case ExtendedPromiseStatus.Fulfilled:
              return r.value;
            case ExtendedPromiseStatus.Rejected:
              return (r.reason as Error).message;
            case ExtendedPromiseStatus.Aborted:
              return "aborted";
            case ExtendedPromiseStatus.Timeout:
              return "timeout";
          }
        });
        expect(testResultsCmp).toEqual(results);
      });
    }
  });
});
