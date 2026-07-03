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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves when the worker terminates and emits a termination event", async () => {
    mockEvents([{type: "termination"}]);
    vi.mocked(Thread.terminate).mockResolvedValue(undefined as never);

    await expect(terminateWorkerThread({worker, retryMs, retryCount})).resolves.toBeUndefined();
    expect(Thread.terminate).toHaveBeenCalledTimes(1);
  });

  it("throws bounded instead of hanging when Thread.terminate() never resolves", async () => {
    // Simulate a worker stuck in a blocking native call: terminate() never resolves and no
    // termination event is ever emitted. The old implementation awaited terminate() outside the
    // race and would hang forever; the fix must fall through to the throw within the retry budget.
    mockEvents([]);
    vi.mocked(Thread.terminate).mockReturnValue(new Promise<void>(() => {}) as never);

    const start = Date.now();
    await expect(terminateWorkerThread({worker, retryMs, retryCount})).rejects.toThrow(
      `Worker thread failed to terminate in ${retryCount * retryMs}ms.`
    );
    // Must have retried the terminate call each iteration and stayed bounded (allow generous slack).
    expect(Thread.terminate).toHaveBeenCalledTimes(retryCount);
    expect(Date.now() - start).toBeLessThan(retryMs * retryCount * 20);
  });
});
