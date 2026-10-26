import {afterEach, expect, it, vi} from "vitest";
import {ErrorAborted, TimeoutError, defer} from "@lodestar/utils";
import {RequestCapacity} from "../../../../src/network/reqresp/requestCapacity.js";

afterEach(() => vi.useRealTimers());

it("does not lose a notification that overtakes a worker check reply", async () => {
  const first = defer<boolean>();
  const watch = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(true);
  const capacity = new RequestCapacity(watch);
  const wait = capacity.wait("token", {signal: new AbortController().signal, timeoutMs: 1000});
  capacity.changed();
  first.resolve(false);
  await wait;
  expect(watch).toHaveBeenCalledTimes(2);
  capacity.close();
});

it("rechecks only dirty waits when worker replies overlap", async () => {
  vi.useFakeTimers();
  const first = defer<boolean>();
  const second = defer<boolean>();
  const recheck = defer<boolean>();
  const watch = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
    .mockReturnValueOnce(recheck.promise)
    .mockResolvedValue(false);
  const capacity = new RequestCapacity(watch);
  const options = {signal: new AbortController().signal, timeoutMs: 1000};
  const waits = [capacity.wait("first", options).catch(() => {}), capacity.wait("second", options).catch(() => {})];
  capacity.changed();
  first.resolve(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(watch).toHaveBeenCalledTimes(3);
  second.resolve(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(watch).toHaveBeenCalledTimes(4);
  recheck.resolve(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(watch).toHaveBeenCalledTimes(4);
  capacity.close();
  await Promise.all(waits);
});

it("uses a fixed deadline through unrelated notifications and cancels watches", async () => {
  vi.useFakeTimers();
  const watch = vi.fn().mockResolvedValue(false);
  const capacity = new RequestCapacity(watch);
  const controller = new AbortController();
  const result = capacity.wait("token", {signal: controller.signal, timeoutMs: 1000}).catch((error) => error);
  await vi.advanceTimersByTimeAsync(500);
  capacity.changed();
  await vi.advanceTimersByTimeAsync(500);
  expect(await result).toBeInstanceOf(TimeoutError);
  const cancelled = capacity.wait("token", {signal: controller.signal, timeoutMs: 1000}).catch((error) => error);
  controller.abort();
  expect(await cancelled).toBeInstanceOf(ErrorAborted);
  const closing = capacity
    .wait("token", {signal: new AbortController().signal, timeoutMs: 1000})
    .catch((error) => error);
  capacity.close();
  expect(await closing).toBeInstanceOf(ErrorAborted);
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds waits without retaining requests and accepts an already changed token", async () => {
  const watch = vi.fn().mockResolvedValue(false);
  const capacity = new RequestCapacity(watch);
  const options = {signal: new AbortController().signal, timeoutMs: 1000};
  const waits = Array.from({length: 32}, () => capacity.wait("token", options).catch((error) => error));
  await expect(capacity.wait("token", options)).rejects.toMatchObject({type: {code: "REQUEST_CAPACITY_WAITERS_FULL"}});
  capacity.close();
  expect((await Promise.all(waits)).every((error) => error instanceof ErrorAborted)).toBe(true);
  const changed = new RequestCapacity(async () => true);
  await changed.wait("token", options);
  changed.close();
});
