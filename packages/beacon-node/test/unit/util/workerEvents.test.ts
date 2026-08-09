import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {Thread} from "@chainsafe/threads";
import {terminateWorkerThread} from "../../../src/util/workerEvents.js";

vi.mock("@chainsafe/threads", () => ({
  Thread: {
    terminate: vi.fn(),
    events: vi.fn(),
  },
}));

describe("util / workerEvents / terminateWorkerThread", () => {
  const retryMs = 20;
  const retryCount = 3;
  const worker = {} as Thread;

  function mockEvents(events: Array<{type: string}>): void {
    vi.mocked(Thread.events).mockReturnValue({
      subscribe: (cb: (event: {type: string}) => void) => {
        for (const event of events) cb(event);
        return {unsubscribe: () => {}};
      },
    } as unknown as ReturnType<typeof Thread.events>);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true when the worker terminates and emits a termination event", async () => {
    mockEvents([{type: "termination"}]);
    vi.mocked(Thread.terminate).mockResolvedValue(undefined as never);

    await expect(terminateWorkerThread({worker, retryMs, retryCount})).resolves.toBe(true);
    expect(Thread.terminate).toHaveBeenCalledTimes(1);
  });

  it("returns false in bounded time when Thread.terminate() never resolves (does not hang)", async () => {
    // Worker that never exits, terminate() never resolves
    mockEvents([]);
    vi.mocked(Thread.terminate).mockReturnValue(new Promise<void>(() => {}) as never);

    const promise = terminateWorkerThread({worker, retryMs, retryCount});
    await vi.advanceTimersByTimeAsync(retryMs * retryCount);

    await expect(promise).resolves.toBe(false);
    expect(Thread.terminate).toHaveBeenCalledTimes(retryCount);
  });

  it("stops reporting a failure once the worker terminates after the deadline", async () => {
    // `unterminatedWorkers` is module state and the test above leaves a worker permanently
    // unterminated on purpose, so take a fresh module instance to isolate the count
    vi.resetModules();
    const {terminateWorkerThread: terminate, hasWorkerTerminationFailed: hasFailed} = await import(
      "../../../src/util/workerEvents.js"
    );

    // no termination event during the retries, so it gives up and records the worker as running
    let emit: ((event: {type: string}) => void) | undefined;
    vi.mocked(Thread.events).mockReturnValue({
      subscribe: (cb: (event: {type: string}) => void) => {
        emit = cb;
        return {unsubscribe: () => {}};
      },
    } as unknown as ReturnType<typeof Thread.events>);
    vi.mocked(Thread.terminate).mockReturnValue(new Promise<void>(() => {}) as never);

    const promise = terminate({worker, retryMs, retryCount});
    await vi.advanceTimersByTimeAsync(retryMs * retryCount);
    await expect(promise).resolves.toBe(false);
    expect(hasFailed()).toBe(true);

    // the worker terminates late, while the rest of the shutdown is still running
    emit?.({type: "termination"});
    await vi.advanceTimersByTimeAsync(0);
    expect(hasFailed()).toBe(false);
  });
});
