import {afterEach, expect, test, vi} from "vitest";
import {CommandQueue} from "../src/network-commands.js";

const full = () => Object.assign(new Error("NetworkCommandFull"), {capacityToken: "0", code: "NetworkCommandFull"});

afterEach(() => vi.useRealTimers());

test("blocked connects preserve per-peer order while unrelated commands proceed", async () => {
  vi.useFakeTimers();
  let available = false;
  const queue = new CommandQueue(() => available);
  const calls: string[] = [];
  const connect = vi.fn(() => {
    if (!available) throw full();
    calls.push("connect");
    return Promise.resolve();
  });
  const first = queue.submit(connect, "peer", "peer");
  const second = queue.submit(
    () => {
      calls.push("direct");
      return Promise.resolve();
    },
    "peer",
    undefined
  );
  const independent = queue.submit(
    () => {
      calls.push("diagnostic");
      return Promise.resolve();
    },
    undefined,
    undefined
  );
  await vi.runAllTimersAsync();
  await independent;
  expect(calls).toEqual(["diagnostic"]);
  expect(connect).toHaveBeenCalledOnce();
  available = true;
  queue.changed();
  await vi.runAllTimersAsync();
  await Promise.all([first, second]);
  expect(calls).toEqual(["diagnostic", "connect", "direct"]);
  queue.close();
});

test("disconnect cancels unadmitted connects and close rejects all remaining waiters", async () => {
  vi.useFakeTimers();
  const queue = new CommandQueue(() => false);
  const run = vi.fn(() => {
    throw full();
  });
  const cancelled = queue.submit(run, "peer", "peer").catch((error) => error.code);
  const closing = queue.submit(run, "other", "other").catch((error) => error.code);
  queue.cancelConnect("peer");
  expect(await cancelled).toBe("NetworkConnectCancelled");
  queue.close();
  expect(await closing).toBe("NetworkClosed");
  await vi.runAllTimersAsync();
  expect(run).toHaveBeenCalledOnce();
  await expect(queue.submit(run, undefined, undefined)).rejects.toMatchObject({code: "NetworkClosed"});
});

test("a release before the watch wakes the queue, but accepted failures never replay", async () => {
  vi.useFakeTimers();
  const queue = new CommandQueue(() => true);
  const run = vi
    .fn()
    .mockImplementationOnce(() => {
      throw full();
    })
    .mockRejectedValueOnce(full());
  const pending = queue.submit(run, undefined, undefined).catch((error) => error.code);
  await vi.runAllTimersAsync();
  expect(await pending).toBe("NetworkCommandFull");
  queue.changed();
  await vi.runAllTimersAsync();
  expect(run).toHaveBeenCalledTimes(2);
  queue.close();
});
