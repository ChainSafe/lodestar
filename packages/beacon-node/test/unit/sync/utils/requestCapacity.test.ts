import {expect, it, vi} from "vitest";
import {RequestError, RequestErrorCode} from "@lodestar/reqresp";
import {TimeoutError, defer} from "@lodestar/utils";
import {RequestCapacityPause, getRequestCapacityToken} from "../../../../src/sync/utils/requestCapacity.js";

it("coalesces scheduler pauses and ignores completion after cancellation", async () => {
  const first = defer<void>();
  const second = defer<void>();
  const wait = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const resume = vi.fn();
  const failed = vi.fn();
  const pause = new RequestCapacityPause(wait, resume, failed);
  pause.pause("first");
  pause.pause("duplicate");
  expect(wait).toHaveBeenCalledOnce();
  expect(pause.blocked).toBe(true);
  pause.cancel();
  expect(wait.mock.calls[0][1].signal.aborted).toBe(true);
  pause.pause("second");
  first.resolve();
  await first.promise;
  expect(pause.blocked).toBe(true);
  expect(resume).not.toHaveBeenCalled();
  second.resolve();
  await second.promise;
  expect(pause.blocked).toBe(false);
  expect(resume).toHaveBeenCalledOnce();
  expect(failed).not.toHaveBeenCalled();
});

it("a local waiting deadline permits one scheduler retry and preserves attribution", async () => {
  const deadline = new TimeoutError("capacity");
  const wait = vi.fn().mockRejectedValue(deadline);
  const resume = vi.fn();
  const failed = vi.fn();
  const pause = new RequestCapacityPause(wait, resume, failed);
  pause.pause("token");
  await Promise.resolve();
  expect(resume).toHaveBeenCalledOnce();
  expect(failed).toHaveBeenCalledWith(deadline);
  expect(
    getRequestCapacityToken(new RequestError({code: RequestErrorCode.REQUEST_LOCAL_CAPACITY, capacityToken: "token"}))
  ).toBe("token");
  expect(getRequestCapacityToken(new RequestError({code: RequestErrorCode.REQUEST_SELF_RATE_LIMITED}))).toBeNull();
});
