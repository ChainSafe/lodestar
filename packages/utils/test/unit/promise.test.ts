import {describe, it, expect} from "vitest";
import {ExtendedPromiseStatus, ExtendedPromise} from "../../src/promise.js";
import {ErrorAborted, TimeoutError} from "../../src/errors.js";

describe("promise", () => {
  describe("PromiseWithStatus", () => {
    function expectResolvedValue(obj: unknown, val: unknown): void {
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
    ): void {
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
});
