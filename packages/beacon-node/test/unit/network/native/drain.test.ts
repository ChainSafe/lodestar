import {Histogram} from "prom-client";
import {afterEach, describe, expect, it, vi} from "vitest";
import {NativeExchange, NativeExchangeDemand} from "@chainsafe/lodestar-z/network";
import {RegistryMetricCreator} from "../../../../src/metrics/utils/registryMetricCreator.js";
import {NativeDrain, NativeDrainStages} from "../../../../src/network/core/native/drain.js";

const limits = {budgetMs: 8, peers: 32, settle: 32, servingStarts: 8, gossipItems: 64, gossipBytes: 8 * 1024 * 1024};
const gossip = {items: 64, bytes: 8 * 1024 * 1024, ordinary: true, ready: true};
const idle: NativeExchange = {
  settled: 0,
  peers: [],
  serving: [],
  servingQueued: false,
  checks: [],
  gossip: null,
  more: false,
  failure: null,
};

/** Holds every setImmediate callback for the test to run, so a throwing drain does not escape the test. */
function immediates(): (() => void)[] {
  const queued: (() => void)[] = [];
  const hold = (callback: (...args: unknown[]) => void, ...args: unknown[]) => {
    queued.push(() => callback(...args));
  };
  vi.spyOn(globalThis, "setImmediate").mockImplementation(hold as unknown as typeof setImmediate);
  return queued;
}

function macrotask(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function yields(register: RegistryMetricCreator): Promise<Record<string, number>> {
  const metric = await register.getSingleMetric("lodestar_native_drain_yields_total")?.get();
  return Object.fromEntries((metric?.values ?? []).map(({labels, value}) => [String(labels.reason), value]));
}

async function histogram(register: RegistryMetricCreator, name: string): Promise<{sum: number; count: number}> {
  const text = await register.getSingleMetricAsString(name);
  const read = (suffix: string) => Number(new RegExp(`^${name}_${suffix} (\\S+)$`, "m").exec(text)?.[1]);
  return {sum: read("sum"), count: read("count")};
}

function fixture() {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const runtime = {exchange: vi.fn((_demand: NativeExchangeDemand): NativeExchange => idle)};
  const stages = {
    serving: vi.fn<NativeDrainStages["serving"]>(() => 3),
    gossip: vi.fn<NativeDrainStages["gossip"]>(() => gossip),
    deliver: vi.fn<NativeDrainStages["deliver"]>(() => false),
  };
  let open = true;
  const onError = vi.fn((_error: unknown) => false);
  const register = new RegistryMetricCreator();
  const drain = new NativeDrain(runtime, limits, () => (open ? stages : null), onError, register);
  return {
    runtime,
    stages,
    onError,
    register,
    drain,
    advance(ms: number) {
      now += ms;
    },
    close() {
      open = false;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("native drain", () => {
  it("only schedules on notification and makes one exchange per drain", async () => {
    const node = fixture();
    node.drain.request();
    node.drain.request();
    expect(node.runtime.exchange).not.toHaveBeenCalled();
    await macrotask();
    expect(node.stages.serving).toHaveBeenCalledExactlyOnceWith(limits.servingStarts);
    expect(node.stages.gossip).toHaveBeenCalledExactlyOnceWith({
      items: limits.gossipItems,
      bytes: limits.gossipBytes,
      deadline: limits.budgetMs,
    });
    expect(node.runtime.exchange).toHaveBeenCalledExactlyOnceWith({settle: 32, peers: 32, serving: 3, gossip});
    expect(node.stages.deliver).toHaveBeenCalledExactlyOnceWith(idle, gossip, limits.budgetMs);
    await macrotask();
    expect(node.runtime.exchange).toHaveBeenCalledOnce();
    expect(await yields(node.register)).toEqual({idle: 1});
  });

  it("drains again for host work native does not hold, and yields it to the time budget", async () => {
    const node = fixture();
    node.stages.deliver.mockImplementationOnce(() => {
      node.advance(limits.budgetMs);
      return true;
    });
    node.drain.request();
    await macrotask();
    await macrotask();
    expect(node.runtime.exchange).toHaveBeenCalledTimes(2);
    expect(node.stages.gossip).toHaveBeenLastCalledWith(expect.objectContaining({deadline: 2 * limits.budgetMs}));
    await macrotask();
    expect(node.runtime.exchange).toHaveBeenCalledTimes(2);
    expect(await yields(node.register)).toEqual({budget: 1, idle: 1});
  });

  it("drains again while native reports more", async () => {
    const node = fixture();
    node.runtime.exchange.mockReturnValueOnce({...idle, more: true}).mockReturnValueOnce({...idle, more: true});
    node.drain.request();
    for (let i = 0; i < 4; i++) await macrotask();
    expect(node.runtime.exchange).toHaveBeenCalledTimes(3);
    expect(node.stages.deliver).toHaveBeenCalledTimes(3);
    expect(await yields(node.register)).toEqual({caps: 2, idle: 1});
  });

  it("settles only after the host closes, until native has nothing left", async () => {
    const node = fixture();
    node.close();
    node.runtime.exchange.mockReturnValueOnce({...idle, more: true});
    node.drain.request();
    for (let i = 0; i < 3; i++) await macrotask();
    expect(node.runtime.exchange).toHaveBeenCalledTimes(2);
    expect(node.runtime.exchange).toHaveBeenLastCalledWith({settle: 32, peers: 0, serving: 0, gossip: null});
    expect(node.stages.deliver).not.toHaveBeenCalled();
  });

  it("measures each drain's burst through its continuations up to the next macrotask checkpoint", async () => {
    const node = fixture();
    node.stages.deliver.mockImplementation(() => {
      node.advance(1);
      void Promise.resolve().then(() => node.advance(2));
      return false;
    });
    node.stages.deliver.mockImplementationOnce(() => {
      node.advance(1);
      void Promise.resolve().then(() => node.advance(2));
      return true;
    });
    node.drain.request();
    await macrotask();
    await macrotask();
    await macrotask();
    const burst = await histogram(node.register, "lodestar_native_drain_burst_seconds");
    const duration = await histogram(node.register, "lodestar_native_drain_seconds");
    // Two drains: each burst adds the continuation's 2 ms to the drain's own 1 ms, and neither includes the other.
    expect(burst.count).toBe(2);
    expect(duration.count).toBe(2);
    expect(duration.sum).toBeCloseTo(0.002, 9);
    expect(burst.sum).toBeCloseTo(0.006, 9);
  });

  it("reports a serving start the binding could not hand over after delivering the rest, and drains again", async () => {
    const node = fixture();
    const failure = new Error("facade construction failed");
    const result = {...idle, more: true, failure};
    node.runtime.exchange.mockReturnValueOnce(result);
    node.drain.request();
    await macrotask();
    expect(node.stages.deliver).toHaveBeenCalledExactlyOnceWith(result, gossip, limits.budgetMs);
    expect(node.onError).toHaveBeenCalledExactlyOnceWith(failure);
    await macrotask();
    expect(node.runtime.exchange).toHaveBeenCalledTimes(2);
  });

  it("schedules the next drain while native holds more whatever error reporting or instrumentation throws", async () => {
    const node = fixture();
    const queued = immediates();
    const failure = new Error("reporting failed");
    node.runtime.exchange.mockReturnValue({...idle, more: true, failure: new Error("facade construction failed")});
    node.onError.mockImplementationOnce(() => {
      throw failure;
    });
    node.drain.request();
    expect(() => queued.shift()?.()).toThrow(failure);
    // The burst end, then the next drain.
    expect(queued).toHaveLength(2);
    queued.shift()?.();
    const duration = node.register.getSingleMetric("lodestar_native_drain_seconds") as Histogram;
    vi.spyOn(duration, "observe").mockImplementation(() => {
      throw failure;
    });
    expect(() => queued.shift()?.()).toThrow(failure);
    expect(node.runtime.exchange).toHaveBeenCalledTimes(2);
    expect(queued).toHaveLength(2);
  });

  it("retries a failure its handler recovers, and a failed delivery while native holds more", async () => {
    const node = fixture();
    const failure = new Error("drain failed");
    node.runtime.exchange.mockImplementationOnce(() => {
      throw failure;
    });
    node.onError.mockReturnValueOnce(true);
    node.drain.request();
    await macrotask();
    expect(node.onError).toHaveBeenCalledExactlyOnceWith(failure);
    node.runtime.exchange.mockReturnValueOnce({...idle, more: true});
    node.stages.deliver.mockImplementationOnce(() => {
      throw failure;
    });
    await macrotask();
    expect(node.onError).toHaveBeenCalledTimes(2);
    node.stages.deliver.mockImplementationOnce(() => {
      throw failure;
    });
    await macrotask();
    await macrotask();
    expect(node.onError).toHaveBeenCalledTimes(3);
    expect(node.runtime.exchange).toHaveBeenCalledTimes(3);
  });
});
