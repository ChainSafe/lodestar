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
  // A fake Thread handle - the mocked Thread.* statics ignore it.
  const worker = {} as Thread;

  /** Build a Thread.events observable stub that emits the given events on subscribe. */
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
    // Simulate a worker stuck in a blocking native call: terminate() never resolves and no
    // termination event is ever emitted. The old implementation awaited terminate() outside the
    // race and would hang forever; the fix falls through within the retry budget and returns false
    // (rather than throwing, which would abort the rest of graceful shutdown).
    mockEvents([]);
    vi.mocked(Thread.terminate).mockReturnValue(new Promise<void>(() => {}) as never);

    const promise = terminateWorkerThread({worker, retryMs, retryCount});
    // Drive the per-retry `sleep(retryMs)` timeouts deterministically instead of waiting real time,
    // so the bound is enforced by controlled timer advancement rather than a wall-clock assertion.
    await vi.advanceTimersByTimeAsync(retryMs * retryCount);

    await expect(promise).resolves.toBe(false);
    // Must have retried the terminate call each iteration (bounded to retryCount attempts).
    expect(Thread.terminate).toHaveBeenCalledTimes(retryCount);
  });
});
