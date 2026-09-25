import {Histogram} from "prom-client";
import {afterEach, describe, expect, it, vi} from "vitest";
import {
  NativeExchange,
  NativeExchangeDemand,
  NativeGossipMessage,
  NativeIncomingRequest,
} from "@chainsafe/lodestar-z/network";
import {defer} from "@lodestar/utils";
import {RegistryMetricCreator} from "../../../../src/metrics/utils/registryMetricCreator.js";
import {ACTION_MAX, NativeDrain, NativeDrainStages} from "../../../../src/network/core/native/drain.js";

const limits = {budgetMs: 8, settle: 32};
const host = {
  bytes: 8 * 1024 * 1024,
  capacity: {serving: 32, ordinary: true},
  checks: 64,
  claimOrdinary: true,
  messages: 64,
  peers: 32,
  servingStarts: 8,
};
const control: NativeExchangeDemand = {
  bytes: 0,
  capacity: null,
  checks: 0,
  claimOrdinary: false,
  messages: 0,
  peers: 0,
  servingStarts: 0,
  settleCells: 32,
};
const idle: NativeExchange = {
  peers: [],
  serving: [],
  checks: [],
  gossip: null,
  more: false,
  parked: {serving: false, ordinary: false},
  disabledWaiting: false,
  failure: null,
};
const handle = (index: number) => ({index, generation: 1n});

/**
 * Runs held callbacks, firing the fake timers whenever none is held, until the pump escalates or `max` ran. Returns
 * whether it escalated.
 */
function runUntilEscalated(queued: (() => void)[], max: number): boolean {
  for (let i = 0; i < max; i++) {
    if (queued.length === 0) vi.advanceTimersByTime(25);
    try {
      queued.shift()?.();
    } catch (error) {
      if (error instanceof Escalated) return true;
      throw error;
    }
  }
  return false;
}

/** Holds every setImmediate callback for the test to run, so a throwing turn does not escape the test. */
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

class Escalated extends Error {}

function fixture() {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const closed = defer<{reason: "requested"}>();
  const runtime = {
    exchange: vi.fn((_actions: unknown, _demand: NativeExchangeDemand): NativeExchange => idle),
    fail: vi.fn((trigger: number, _reason: string): never => {
      throw new Escalated(String(trigger));
    }),
    closed: closed.promise,
  };
  const stages = {
    demand: vi.fn<NativeDrainStages["demand"]>(() => host),
    deliver: vi.fn<NativeDrainStages["deliver"]>(() => false),
  };
  let open = true;
  const onError = vi.fn((_error: unknown) => {});
  const onFailure = vi.fn((_error: unknown) => {});
  const register = new RegistryMetricCreator();
  const drain = new NativeDrain(runtime, limits, () => (open ? stages : null), onError, onFailure, register);
  return {
    runtime,
    stages,
    onError,
    onFailure,
    register,
    drain,
    closed,
    /** Actions and demand of each exchange. */
    calls: () => runtime.exchange.mock.calls,
    advance(ms: number) {
      now += ms;
    },
    close() {
      open = false;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("native pump", () => {
  it("only schedules on notification and makes one exchange per turn", async () => {
    const node = fixture();
    node.drain.request();
    node.drain.request();
    expect(node.runtime.exchange).not.toHaveBeenCalled();
    await macrotask();
    expect(node.stages.demand).toHaveBeenCalledExactlyOnceWith(limits.budgetMs);
    expect(node.runtime.exchange).toHaveBeenCalledExactlyOnceWith([], {...host, settleCells: 32});
    expect(node.stages.deliver).toHaveBeenCalledExactlyOnceWith(
      {checks: [], jobs: [], peers: [], starts: []},
      limits.budgetMs
    );
    await macrotask();
    expect(node.runtime.exchange).toHaveBeenCalledOnce();
    expect(await yields(node.register)).toEqual({idle: 1});
  });

  it("turns again at once for held jobs, and yields them to the time budget", async () => {
    const node = fixture();
    node.stages.deliver.mockImplementationOnce(() => {
      node.advance(limits.budgetMs);
      return true;
    });
    node.drain.request();
    await macrotask();
    await macrotask();
    expect(node.runtime.exchange).toHaveBeenCalledTimes(2);
    expect(node.stages.demand).toHaveBeenLastCalledWith(2 * limits.budgetMs);
    await macrotask();
    expect(node.runtime.exchange).toHaveBeenCalledTimes(2);
    expect(await yields(node.register)).toEqual({budget: 1, idle: 1});
  });

  it("turns again at once when the time budget left ordinary work unclaimed", async () => {
    const node = fixture();
    node.stages.demand.mockReturnValueOnce({...host, claimOrdinary: false});
    node.runtime.exchange.mockReturnValueOnce({...idle, disabledWaiting: true});
    node.drain.request();
    await macrotask();
    await macrotask();
    expect(node.runtime.exchange).toHaveBeenCalledTimes(2);
  });

  it("a serving capacity of 32 under a quota of 8 takes four immediate turns and no timer", async () => {
    vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
    const node = fixture();
    for (let i = 0; i < 3; i++) node.runtime.exchange.mockReturnValueOnce({...idle, more: true});
    node.drain.request();
    for (let i = 0; i < 5; i++) await macrotask();
    expect(node.runtime.exchange).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
    expect(await yields(node.register)).toEqual({caps: 3, idle: 1});
  });

  it("retries parked external capacity on the single timer until capacity returns", async () => {
    vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
    const node = fixture();
    const parked = {...idle, parked: {serving: true, ordinary: true}};
    node.runtime.exchange.mockReturnValueOnce(parked).mockReturnValueOnce(parked);
    node.drain.request();
    await macrotask();
    expect(vi.getTimerCount()).toBe(1);
    // Another request does not add a timer.
    node.drain.request();
    await macrotask();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(25);
    await macrotask();
    expect(node.runtime.exchange).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
    expect(node.runtime.fail).not.toHaveBeenCalled();
  });

  it("settles only after the host closes, retrying disabled payload on the timer, until native reports closed", async () => {
    vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
    const node = fixture();
    node.close();
    node.runtime.exchange.mockReturnValueOnce({...idle, more: true}).mockReturnValue({...idle, disabledWaiting: true});
    node.drain.request();
    for (let i = 0; i < 3; i++) await macrotask();
    expect(node.calls()).toEqual([
      [[], control],
      [[], control],
    ]);
    expect(vi.getTimerCount()).toBe(1);
    node.closed.resolve({reason: "requested"});
    await macrotask();
    expect(vi.getTimerCount()).toBe(0);
    node.drain.request();
    await macrotask();
    expect(node.runtime.exchange).toHaveBeenCalledTimes(2);
    expect(node.stages.deliver).not.toHaveBeenCalled();
  });

  it("sends obligations first, 256 per exchange, and coalesces blocks, rechecks and peer penalties", async () => {
    const node = fixture();
    const captured: unknown[][] = [];
    node.runtime.exchange.mockImplementation((actions) => {
      captured.push([...(actions as unknown[])]);
      return idle;
    });
    for (let i = 0; i < 1000; i++) node.drain.verdict(handle(i), "accept");
    node.drain.block(new Uint8Array(32).fill(1));
    node.drain.block(new Uint8Array(32).fill(1));
    for (let i = 0; i < 150; i++) node.drain.reportPeer("peer", "high_tolerance");
    node.drain.reportPeer("peer", "fatal");
    node.drain.dropQueued();
    for (let i = 0; i < 6; i++) await macrotask();
    expect(captured.map((actions) => actions.length)).toEqual([ACTION_MAX, ACTION_MAX, ACTION_MAX, 1000 - 768 + 4]);
    expect(
      captured
        .slice(0, 3)
        .flat()
        .every((action) => (action as {type: string}).type === "verdict")
    ).toBe(true);
    expect(captured[3].slice(1000 - 768)).toEqual([
      {root: new Uint8Array(32).fill(1), type: "block"},
      {action: "high_tolerance", count: 100, peerId: "peer", type: "reportPeer"},
      {action: "fatal", count: 1, peerId: "peer", type: "reportPeer"},
      {type: "dropQueued"},
    ]);
    // Roots past the coalescing bound become one recheck of every waiting message.
    for (let i = 0; i < 257; i++) node.drain.block(Uint8Array.of(i >> 8, i & 255));
    node.drain.block(new Uint8Array(32).fill(2));
    await macrotask();
    expect(captured.at(-1)).toEqual([{type: "recheck"}]);
  });

  it("drops peer penalties past 512 coalesced entries and counts them", async () => {
    const node = fixture();
    for (let i = 0; i < 514; i++) node.drain.reportPeer(`peer-${i}`, "fatal");
    expect(node.drain.reportsDropped).toBe(2);
    await macrotask();
    expect(node.calls()[0][0]).toHaveLength(ACTION_MAX);
    await macrotask();
    expect(node.calls()[1][0]).toHaveLength(512 - ACTION_MAX);
  });

  it("keeps a penalty reported while its batch is in flight for the next exchange", async () => {
    const node = fixture();
    // Legacy settlement can run a promise's `then` getter inside the exchange, which may report the same peer.
    node.runtime.exchange.mockImplementationOnce(() => {
      node.drain.reportPeer("peer", "fatal");
      return idle;
    });
    node.drain.reportPeer("peer", "fatal");
    await macrotask();
    await macrotask();
    const report = {action: "fatal", count: 1, peerId: "peer", type: "reportPeer"};
    expect(node.calls().map(([actions]) => actions)).toEqual([[report], [report]]);
  });

  it("escalates a batch native refuses", async () => {
    const node = fixture();
    const queued = immediates();
    const refusal = Object.assign(new Error("InvalidNetworkActions"), {code: "InvalidNetworkActions"});
    node.runtime.exchange.mockImplementationOnce(() => {
      throw refusal;
    });
    node.drain.request();
    expect(() => queued.shift()?.()).toThrow(Escalated);
    expect(node.runtime.fail).toHaveBeenCalledExactlyOnceWith(1, "InvalidNetworkActions");
  });

  it("retries a failed demand on the timer, settling control each turn, and escalates the third", () => {
    vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
    const node = fixture();
    const queued = immediates();
    const failure = new Error("demand failed");
    node.stages.demand.mockImplementation(() => {
      throw failure;
    });
    node.drain.request();
    expect(runUntilEscalated(queued, 20)).toBe(true);
    expect(node.calls()).toEqual([
      [[], control],
      [[], control],
    ]);
    expect(node.onError).toHaveBeenCalledTimes(2);
    expect(node.onFailure).not.toHaveBeenCalled();
    expect(node.stages.deliver).not.toHaveBeenCalled();
    expect(node.runtime.fail).toHaveBeenCalledExactlyOnceWith(3, "demand failed");
  });

  it("a demand that succeeds resets the failure count", () => {
    vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
    const node = fixture();
    const queued = immediates();
    const failure = new Error("demand failed");
    const fails = [true, true, false, true, true];
    node.stages.demand.mockImplementation(() => {
      if (fails.shift()) throw failure;
      return host;
    });
    // The delivering turn reports more, so the failing demands after it follow at once, then on the timer.
    node.runtime.exchange.mockImplementation((_actions, demand) =>
      demand.messages > 0 && fails.length > 0 ? {...idle, more: true} : idle
    );
    node.drain.request();
    expect(runUntilEscalated(queued, 20)).toBe(false);
    expect(node.stages.demand).toHaveBeenCalledTimes(6);
    expect(node.onError).toHaveBeenCalledTimes(4);
  });

  it("a throw before phase B leaves the batch queued and retries on the timer", async () => {
    vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
    const node = fixture();
    const failure = new Error("exchange failed");
    node.runtime.exchange.mockImplementationOnce(() => {
      throw failure;
    });
    node.drain.reportPeer("peer", "fatal");
    node.drain.classify(handle(3), false);
    await macrotask();
    expect(node.onError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(25);
    await macrotask();
    expect(node.calls()[1][0]).toEqual([
      {available: false, handle: handle(3), type: "classify"},
      {action: "fatal", count: 1, peerId: "peer", type: "reportPeer"},
    ]);
    expect(node.runtime.fail).not.toHaveBeenCalled();
  });

  it("never escalates turns without deliveries: external capacity polling and held jobs", async () => {
    vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
    const node = fixture();
    node.runtime.exchange.mockReturnValue({...idle, parked: {serving: true, ordinary: false}});
    node.stages.deliver.mockReturnValue(true);
    node.drain.request();
    for (let i = 0; i < 20; i++) {
      await macrotask();
      vi.advanceTimersByTime(25);
    }
    expect(node.runtime.exchange.mock.calls.length).toBeGreaterThan(10);
    expect(node.runtime.fail).not.toHaveBeenCalled();
    node.closed.resolve({reason: "requested"});
  });

  it("ignores jobs and cancels serving starts the host never adopted, but not adopted ones, when it throws", async () => {
    const node = fixture();
    const message = (index: number) => ({handle: handle(index)}) as NativeGossipMessage;
    const start = () => ({cancel: vi.fn(() => Promise.resolve())}) as unknown as NativeIncomingRequest;
    const starts = [start(), start()];
    node.runtime.exchange.mockReturnValueOnce({
      ...idle,
      serving: starts,
      gossip: {
        messages: [message(1), message(2), message(3)],
        jobs: [
          {kind: "beacon_block", start: 0, length: 1, grouped: false, urgent: true},
          {kind: "voluntary_exit", start: 1, length: 2, grouped: false, urgent: false},
        ],
      },
    });
    const failure = new Error("handler failed");
    node.stages.deliver.mockImplementationOnce(({jobs, starts: claims}) => {
      jobs[0].adopt();
      claims[0].adopt();
      throw failure;
    });
    node.drain.request();
    await macrotask();
    expect(node.onFailure).toHaveBeenCalledExactlyOnceWith(failure);
    expect(starts[0].cancel).not.toHaveBeenCalled();
    expect(starts[1].cancel).toHaveBeenCalledOnce();
    await macrotask();
    expect(node.calls()[1][0]).toEqual([
      {handle: handle(2), type: "verdict", verdict: "ignore"},
      {handle: handle(3), type: "verdict", verdict: "ignore"},
    ]);
  });

  it("measures each turn's burst through its continuations up to the next macrotask checkpoint", async () => {
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
    // Two turns: each burst adds the continuation's 2 ms to the turn's own 1 ms, and neither includes the other.
    expect(burst.count).toBe(2);
    expect(duration.count).toBe(2);
    expect(duration.sum).toBeCloseTo(0.002, 9);
    expect(burst.sum).toBeCloseTo(0.006, 9);
  });

  it("reports a serving start the binding could not hand over after delivering the rest, and turns again", async () => {
    const node = fixture();
    const failure = new Error("facade construction failed");
    node.runtime.exchange.mockReturnValueOnce({...idle, more: true, failure});
    node.drain.request();
    await macrotask();
    expect(node.stages.deliver).toHaveBeenCalledOnce();
    expect(node.onFailure).toHaveBeenCalledExactlyOnceWith(failure);
    await macrotask();
    expect(node.runtime.exchange).toHaveBeenCalledTimes(2);
  });

  it("schedules the next turn while native holds more whatever error reporting or instrumentation throws", async () => {
    const node = fixture();
    const queued = immediates();
    const failure = new Error("reporting failed");
    node.runtime.exchange.mockReturnValue({...idle, more: true, failure: new Error("facade construction failed")});
    node.onFailure.mockImplementationOnce(() => {
      throw failure;
    });
    node.drain.request();
    expect(() => queued.shift()?.()).toThrow(failure);
    // The burst end, then the next turn.
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
});
