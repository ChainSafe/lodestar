import {afterEach, describe, expect, it, vi} from "vitest";
import type {
  DependencyCheck,
  GossipJob,
  HostCapacity,
  IncomingRequest,
  NativeLogRecord,
  NativePeerObservation,
  NativeTopicKind,
  Verdict,
} from "../src/network.js";
import {BURST_NAME, NativePump} from "../src/network-pump.js";
import type {
  NativeDelivery as NativeExchange,
  NativeGossipBatch,
  NativeGossipDependencyCheck,
  NativeGossipHandle,
  NativeGossipMessage,
  NativeIncomingRequest,
  NativeLogBatch,
} from "../src/network-types.js";
import {childTestTimeout, spawnChild} from "./utils/network.js";

vi.mock("../src/network-incoming.js", () => {
  class NativeIncoming {
    constructor(_native: unknown, descriptor: NativeIncomingRequest) {
      Object.assign(this, descriptor);
    }
  }
  // biome-ignore lint/style/useNamingConvention: The mock must export the module's constructor name.
  return {NativeIncoming};
});

const full = {gossipValidation: "ready"} as const;
const control = null;
const idle: NativeExchange = {
  capacityChanged: false,
  checks: [],
  gossip: null,
  identity: null,
  needsAnotherExchange: false,
  peers: [],
  serving: [],
};
const handle = (index: number, generation = 1n): NativeGossipHandle => ({generation, index});
/** Each fixture's native close, which the test may leave pending. */
const running: {resolve(result: {reason: "requested"}): void}[] = [];
/** The pump's log delivery timer, armed until native closes. */
const LOG_TIMER = 1;
const noLogs = {more: false, records: []};

function macrotask(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function message(index: number, generation = 1n): NativeGossipMessage {
  return {
    attestationData: null,
    connection: {generation: 1, index: 0},
    data: new Uint8Array(4).fill(index),
    endpoint: null,
    handle: handle(index, generation),
    id: new Uint8Array(20).fill(index),
    peerId: "peer",
    receivedAtUnixMs: 12345,
    slot: 7n,
    topic: "topic",
  };
}

type JobSpec = {messages: number[]; urgent?: boolean; grouped?: boolean; kind?: NativeTopicKind; generation?: bigint};

/** One batch of jobs, each listing its messages' cell indexes, in priority order. */
function gossip(...specs: JobSpec[]): NativeGossipBatch {
  const messages: NativeGossipMessage[] = [];
  const jobs = specs.map(({messages: indexes, urgent = false, grouped = false, kind, generation}) => {
    const start = messages.length;
    messages.push(...indexes.map((index) => message(index, generation)));
    return {
      grouped,
      kind: kind ?? (urgent ? "beacon_block" : grouped ? "beacon_attestation" : "voluntary_exit"),
      length: indexes.length,
      start,
    };
  });
  return {jobs, messages};
}

function check(index: number): NativeGossipDependencyCheck {
  return {
    handle: handle(index),
    kind: "beacon_block",
    parentBlockHash: null,
    payloadPresent: true,
    peerId: "peer",
    root: new Uint8Array(32).fill(index),
    slot: 3n,
    topic: "topic",
  };
}

function incoming(name = "start") {
  const closed = Promise.withResolvers<void>();
  const request = {
    cancel: vi.fn(() => Promise.resolve()),
    closed: closed.promise,
    connection: {generation: 1, index: 1},
    data: new Uint8Array(32),
    fail: vi.fn((_status: number, _message: Uint8Array) => Promise.resolve()),
    finish: vi.fn(() => Promise.resolve()),
    handle: {generation: 1n, index: 0},
    name,
    peerId: "peer",
    protocol: "/eth2/beacon_chain/req/beacon_blocks_by_root/2/ssz_snappy" as const,
    ready: vi.fn(() => Promise.resolve()),
    respond: vi.fn(() => Promise.resolve()),
    retainUntil: vi.fn((_retired: Promise<void>): void => undefined),
  };
  return request;
}
type Incoming = ReturnType<typeof incoming>;

const peerEvent: NativePeerObservation = {
  connection: {generation: 1, index: 0},
  identity: "peer",
  reason: "host",
  type: "closed",
};

function fixture() {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const closed = Promise.withResolvers<{reason: "requested"} | {reason: "failed"; error: Error}>();
  running.push(closed);
  const runtime = {
    classifyGossip: vi.fn((_handle: NativeGossipHandle, _available: boolean) => undefined),
    close: vi.fn(() => closed.promise),
    closed: closed.promise,
    drainLogs: vi.fn((_max: number): NativeLogBatch => noLogs),
    exchange: vi.fn((): NativeExchange => idle),
    reportGossip: vi.fn((_handle: NativeGossipHandle, _verdict: Verdict) => undefined),
    setCapacity: vi.fn((_capacity: HostCapacity | null) => undefined),
    state: "running",
  };
  const host = {
    capacity: vi.fn((): HostCapacity => ({gossipValidation: "ready"})),
    checkDependencies: vi.fn((checks: readonly DependencyCheck[]): readonly boolean[] => checks.map(() => true)),
    error: vi.fn((_error: unknown): void => undefined),
    failed: vi.fn((_error: Error): void => undefined),
    logs: vi.fn((_records: readonly NativeLogRecord[]): void => undefined),
    peers: vi.fn((_events: readonly NativePeerObservation[]): void => undefined),
    serve: vi.fn((_request: IncomingRequest): Promise<void> => Promise.resolve()),
    subscribeCapacity: vi.fn((_wake: () => void) => vi.fn()),
    validate: vi.fn(
      (job: GossipJob): Promise<readonly Verdict[]> => Promise.resolve(job.messages.map(() => "accept" as const))
    ),
  };
  const capacityChanged = vi.fn();
  const pump = new NativePump(host, undefined, capacityChanged);
  pump.attach(runtime, closed.promise);
  return {
    advance(ms: number) {
      now += ms;
    },
    capacities: () => runtime.setCapacity.mock.calls.map(([capacity]) => capacity),
    capacityChanged,
    closed,
    host,
    get now() {
      return now;
    },
    pump,
    runtime,
  };
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // Native closes under every pump a test left running, which stops its log timer before a later test fakes timers.
  for (const closed of running.splice(0)) closed.resolve({reason: "requested"});
  await macrotask();
});

describe("binding pump scheduling", () => {
  it("only schedules on notification and makes one exchange per turn", async () => {
    const node = fixture();
    node.pump.request();
    node.pump.request();
    expect(node.runtime.exchange).not.toHaveBeenCalled();
    await macrotask();
    expect(node.host.capacity).toHaveBeenCalledOnce();
    expect(node.runtime.exchange).toHaveBeenCalledExactlyOnceWith();
    for (const callback of ["validate", "checkDependencies", "serve", "peers"] as const)
      expect(node.host[callback]).not.toHaveBeenCalled();
    await macrotask();
    expect(node.runtime.exchange).toHaveBeenCalledOnce();
  });

  it("forwards host readiness and stops payload delivery explicitly", async () => {
    const node = fixture();
    node.host.capacity.mockReturnValueOnce({gossipValidation: "backpressured"});
    node.pump.request();
    await macrotask();
    node.pump.stopDelivery();
    node.runtime.exchange.mockReturnValueOnce({...idle, checks: [check(1)], peers: [peerEvent]});
    node.pump.request();
    await macrotask();
    expect(node.capacities()).toEqual([{gossipValidation: "backpressured"}, control]);
    // Control-only draining hands the host nothing.
    expect(node.host.peers).not.toHaveBeenCalled();
    expect(node.host.checkDependencies).not.toHaveBeenCalled();
  });

  it("hands over a complete batch after expensive capacity and exchange calls, then yields before the next batch", async () => {
    const node = fixture();
    node.host.capacity.mockImplementationOnce(() => {
      node.advance(100);
      return {gossipValidation: "ready"};
    });
    node.host.validate.mockImplementation(() => {
      node.advance(100);
      return new Promise(() => undefined);
    });
    node.runtime.exchange
      .mockImplementationOnce(() => {
        node.advance(100);
        return {...idle, gossip: gossip({messages: [1]}, {messages: [2]}), needsAnotherExchange: true};
      })
      .mockReturnValueOnce({...idle, gossip: gossip({messages: [3]})});
    node.pump.request();
    await macrotask();
    expect(node.runtime.exchange).toHaveBeenCalledOnce();
    expect(node.host.validate).toHaveBeenCalledTimes(2);
    expect(node.capacities()[0]).toEqual(full);
    await macrotask();
    expect(node.host.validate).toHaveBeenCalledTimes(3);
    expect(node.runtime.exchange).toHaveBeenCalledTimes(2);
    await macrotask();
    expect(node.runtime.exchange).toHaveBeenCalledTimes(2);
  });

  it("starts serving batches in order without waiting for handlers or imposing a JS capacity limit", async () => {
    const node = fixture();
    const starts = Array.from({length: 40}, () => incoming());
    const queue = starts.slice();
    node.host.serve.mockImplementation(() => {
      node.advance(100);
      return new Promise(() => undefined);
    });
    node.runtime.exchange.mockImplementation(() => {
      node.advance(100);
      const serving = queue.splice(0, 8);
      return {...idle, needsAnotherExchange: queue.length > 0, serving};
    });
    for (let turn = 0; turn < 5; turn++) {
      await macrotask();
      expect(node.host.serve, `serving starts after turn ${turn}`).toHaveBeenCalledTimes((turn + 1) * 8);
    }
    for (const start of starts) {
      expect(start.retainUntil).toHaveBeenCalledOnce();
      expect(start.cancel).not.toHaveBeenCalled();
    }
    const retained = starts.map((start) => start.retainUntil.mock.invocationCallOrder[0]);
    expect(retained).toEqual([...retained].sort((a, b) => a - b));
    await macrotask();
    expect(node.runtime.exchange).toHaveBeenCalledTimes(5);
  });

  it("uses readiness after payload delivery instead of scheduling an empty follow-up turn", async () => {
    const node = fixture();
    node.runtime.exchange.mockReturnValueOnce({...idle, peers: [peerEvent]});
    await macrotask();
    await macrotask();
    expect(node.runtime.exchange).toHaveBeenCalledOnce();
    expect(node.host.peers).toHaveBeenCalledOnce();
  });

  it("waits for a capacity notification without polling", async () => {
    vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
    const node = fixture();
    node.host.capacity.mockReturnValue({gossipValidation: "backpressured"});
    await macrotask();
    expect(node.runtime.exchange).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(100);
    await macrotask();
    expect(node.runtime.exchange).toHaveBeenCalledOnce();
    const wake = node.host.subscribeCapacity.mock.calls[0][0];
    node.host.capacity.mockReturnValue({gossipValidation: "ready"});
    wake();
    wake();
    await macrotask();
    expect(node.runtime.exchange).toHaveBeenCalledTimes(2);
    wake();
    await macrotask();
    expect(node.runtime.exchange).toHaveBeenCalledTimes(3);
    expect(node.capacities().slice(-2)).toEqual([{gossipValidation: "ready"}, {gossipValidation: "ready"}]);
    expect(vi.getTimerCount()).toBe(LOG_TIMER);
  });

  it("unsubscribes once when delivery stops and continues completion draining", async () => {
    const node = fixture();
    await macrotask();
    const unsubscribe = node.host.subscribeCapacity.mock.results[0].value;
    node.pump.stopDelivery();
    node.pump.stopDelivery();
    await macrotask();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(node.capacities().at(-1)).toEqual(control);
    node.pump.request();
    await macrotask();
    expect(node.host.capacity).toHaveBeenCalledOnce();
    expect(node.runtime.exchange).toHaveBeenCalledTimes(3);
  });

  it.each([
    [
      "throws",
      () => {
        throw new Error("capacity failed");
      },
    ],
    ["returns null", () => null],
    ["returns an invalid snapshot", () => ({gossipValidation: "yes"})],
  ])("fails delivery when capacity %s while continuing settlement", async (_, read) => {
    const node = fixture();
    node.host.capacity.mockImplementation(read as () => HostCapacity);
    await macrotask();
    expect(node.capacities()[0]).toEqual(control);
    expect(node.host.failed).toHaveBeenCalledOnce();
    expect(node.host.subscribeCapacity.mock.results[0].value).toHaveBeenCalledOnce();
    node.pump.request();
    await macrotask();
    expect(node.host.capacity).toHaveBeenCalledOnce();
    expect(node.host.peers).not.toHaveBeenCalled();
    expect(node.runtime.exchange).toHaveBeenCalledTimes(2);
  });

  it("a real runtime settles commands after capacity failure and closes", childTestTimeout(), () => {
    const child = spawnChild(["--import", "tsx", "bindings/test/fixtures/network-capacity-failure.mjs"]);
    expect(child.status, child.stderr).toBe(0);
    expect(child.signal, child.stderr).toBeNull();
    expect(child.stdout).toContain("capacity failed; identity settled; closed");
    expect(child.stdout).not.toContain("survived");
  });

  it("keeps turning whatever the host's error sink throws", async () => {
    const node = fixture();
    node.host.error.mockImplementation(() => {
      throw new Error("sink failed");
    });
    node.host.capacity.mockImplementationOnce(() => {
      throw new Error("capacity failed");
    });
    node.runtime.exchange.mockReturnValueOnce({...idle, needsAnotherExchange: true});
    node.pump.request();
    await macrotask();
    await macrotask();
    expect(node.runtime.exchange).toHaveBeenCalledTimes(2);
    expect(node.capacities()[1]).toEqual(control);
  });

  it("measures each turn's burst through its continuations up to the next macrotask checkpoint", async () => {
    const node = fixture();
    node.host.peers.mockImplementation(() => {
      node.advance(1);
      void Promise.resolve().then(() => node.advance(2));
    });
    node.runtime.exchange.mockReturnValueOnce({...idle, needsAnotherExchange: true, peers: [peerEvent]});
    node.runtime.exchange.mockReturnValueOnce({...idle, peers: [peerEvent]});
    node.pump.request();
    for (let i = 0; i < 3; i++) await macrotask();
    const text = node.pump.metrics();
    const read = (suffix: string) => Number(new RegExp(`^${BURST_NAME}_${suffix} (\\S+)$`, "m").exec(text)?.[1]);
    // Two turns: each burst adds the continuation's 2 ms to the turn's own 1 ms, and neither includes the other.
    expect(read("count")).toBe(2);
    expect(read("sum")).toBeCloseTo(0.006, 9);
    expect(text).toContain(`${BURST_NAME}_bucket{le="0.0025"} 0\n`);
    expect(text).toContain(`${BURST_NAME}_bucket{le="0.005"} 2\n`);
    expect(text).toContain(`# TYPE ${BURST_NAME} histogram\n`);
  });
});

describe("binding pump delivery", () => {
  it("hands peers, then serving starts, then dependency checks, then gossip jobs to the host", async () => {
    const node = fixture();
    const order: string[] = [];
    node.host.peers.mockImplementation(() => void order.push("peers"));
    node.host.serve.mockImplementation(() => {
      order.push("serve");
      return Promise.resolve();
    });
    node.host.checkDependencies.mockImplementation((checks) => {
      order.push("checkDependencies");
      return checks.map(() => true);
    });
    node.host.validate.mockImplementation((job) => {
      order.push(`validate:${job.kind}`);
      return Promise.resolve(job.messages.map(() => "accept" as const));
    });
    node.runtime.exchange.mockReturnValueOnce({
      ...idle,
      checks: [check(9)],
      gossip: gossip({messages: [1], urgent: true}, {messages: [2]}),
      peers: [peerEvent],
      serving: [incoming()],
    });
    node.pump.request();
    await macrotask();
    expect(order).toEqual(["peers", "serve", "checkDependencies", "validate:beacon_block", "validate:voluntary_exit"]);
    expect(node.host.peers).toHaveBeenCalledExactlyOnceWith([peerEvent]);
  });

  it("delivers request capacity notifications while host payload delivery is stopped", async () => {
    const node = fixture();
    node.pump.stopDelivery();
    node.runtime.exchange.mockReturnValueOnce({...idle, capacityChanged: true});
    node.pump.request();
    await macrotask();
    expect(node.capacityChanged).toHaveBeenCalledOnce();
    expect(node.host.validate).not.toHaveBeenCalled();
    await macrotask();
    expect(node.runtime.exchange).toHaveBeenCalledOnce();
  });

  it("retires delivered work if the request capacity listener throws", async () => {
    const node = fixture();
    const start = incoming();
    node.capacityChanged.mockImplementation(() => {
      throw new Error("capacity listener");
    });
    node.runtime.exchange.mockReturnValueOnce({
      ...idle,
      capacityChanged: true,
      checks: [check(9)],
      gossip: gossip({messages: [1]}),
      serving: [start],
    });
    node.pump.request();
    await macrotask();
    expect(node.host.failed).toHaveBeenCalledOnce();
    expect(start.cancel).toHaveBeenCalledOnce();
    expect(node.runtime.classifyGossip).toHaveBeenCalledWith(handle(9), false);
    expect(node.runtime.reportGossip).toHaveBeenCalledWith(handle(1), "ignore");
    expect(node.host.validate).not.toHaveBeenCalled();
  });

  it("delivers gossip in native priority order despite expensive handlers earlier in the batch", async () => {
    const node = fixture();
    const started: number[] = [];
    node.host.validate.mockImplementation((job) => {
      started.push(job.messages[0].data[0]);
      node.advance(100);
      return new Promise(() => undefined);
    });
    node.host.peers.mockImplementation(() => node.advance(100));
    node.runtime.exchange.mockReturnValueOnce({
      ...idle,
      gossip: gossip({messages: [4], urgent: true}, {messages: [5], urgent: true}, {messages: [1]}, {messages: [2]}),
      peers: [peerEvent],
    });
    node.pump.request();
    await macrotask();
    expect(started).toEqual([4, 5, 1, 2]);
    await macrotask();
    expect(node.runtime.exchange).toHaveBeenCalledOnce();
  });

  it.each([
    ["answers", (): readonly boolean[] => [true, false], [true, false], null],
    [
      "throws",
      () => {
        throw new Error("check failed");
      },
      [false, false],
      "check failed",
    ],
    ["miscounts", () => [true], [false, false], "NativeHostContract: checkDependencies"],
    ["returns no array", () => "yes" as unknown as boolean[], [false, false], "NativeHostContract: checkDependencies"],
    ["returns a sparse array", () => new Array<boolean>(2), [false, false], "NativeHostContract: checkDependencies"],
    [
      "returns a partially populated array",
      () => Object.assign([true], {length: 2}),
      [false, false],
      "NativeHostContract: checkDependencies",
    ],
    [
      "returns a non-boolean answer",
      () => [true, 1] as unknown as boolean[],
      [false, false],
      "NativeHostContract: checkDependencies",
    ],
  ])("classifies dependency checks in one call when the host %s", async (_, answer, classes, error) => {
    const node = fixture();
    node.host.checkDependencies.mockImplementationOnce(answer);
    node.runtime.exchange.mockReturnValueOnce({...idle, checks: [check(1), check(2)]});
    node.pump.request();
    await macrotask();
    await macrotask();
    expect(node.host.checkDependencies).toHaveBeenCalledOnce();
    expect(node.runtime.classifyGossip.mock.calls).toEqual([
      [handle(1), classes[0]],
      [handle(2), classes[1]],
    ]);
    if (error === null) expect(node.host.error).not.toHaveBeenCalled();
    else expect(node.host.error).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({message: error}));
  });

  it.each([
    [
      "throws",
      () => {
        throw new Error("validator failed");
      },
      "validator failed",
    ],
    ["rejects", () => Promise.reject(new Error("validator failed")), "validator failed"],
    ["miscounts", () => Promise.resolve(["accept"] as const), "NativeHostContract: validate"],
    ["returns an unknown verdict", () => Promise.resolve(["accept", "maybe"]), "NativeHostContract: validate"],
    ["returns a sparse array", () => Promise.resolve(new Array(2)), "NativeHostContract: validate"],
    [
      "returns a partially populated array",
      () => Promise.resolve(Object.assign(["accept"], {length: 2})),
      "NativeHostContract: validate",
    ],
  ])("ignores every message of a job whose validation %s, and validates the others", async (_, validate, error) => {
    const node = fixture();
    node.host.validate.mockImplementationOnce(validate as () => Promise<readonly Verdict[]>);
    node.runtime.exchange.mockReturnValueOnce({
      ...idle,
      gossip: gossip({grouped: true, messages: [1, 2]}, {messages: [3]}),
    });
    node.pump.request();
    await macrotask();
    await macrotask();
    expect(node.runtime.reportGossip.mock.calls).toEqual([
      [handle(1), "ignore"],
      [handle(2), "ignore"],
      [handle(3), "accept"],
    ]);
    expect(node.host.error).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({message: error}));
    expect(node.host.failed).not.toHaveBeenCalled();
  });

  it("a throwing peer handler ignores every job, cancels every unstarted request once and fails the network", async () => {
    const node = fixture();
    const starts = [incoming("first"), incoming("second")];
    node.runtime.exchange.mockReturnValueOnce({
      ...idle,
      checks: [check(3)],
      gossip: gossip({messages: [4], urgent: true}, {grouped: true, messages: [5, 6]}),
      peers: [peerEvent],
      serving: starts,
    });
    const failure = new Error("peer handler failed");
    node.host.peers.mockImplementation(() => {
      throw failure;
    });
    node.pump.request();
    await macrotask();
    expect(node.host.failed).toHaveBeenCalledExactlyOnceWith(failure);
    // The host closes the network once its cleanup finishes.
    expect(node.runtime.close).not.toHaveBeenCalled();
    for (const start of starts) {
      expect(start.retainUntil).not.toHaveBeenCalled();
      expect(start.cancel).toHaveBeenCalledOnce();
    }
    await macrotask();
    expect(node.capacities()[1]).toBeNull();
    expect(node.runtime.reportGossip.mock.calls).toEqual([4, 5, 6].map((index) => [handle(index), "ignore"]));
    expect(node.runtime.classifyGossip.mock.calls).toEqual([[handle(3), false]]);
    for (const callback of ["validate", "checkDependencies", "serve"] as const)
      expect(node.host[callback]).not.toHaveBeenCalled();
    node.pump.stopDelivery();
    for (const start of starts) expect(start.cancel).toHaveBeenCalledOnce();
  });

  it("keeps settling after a peer handler fails until the host closes", async () => {
    const node = fixture();
    const first = new Error("first failure");
    node.host.peers.mockImplementationOnce(() => {
      throw first;
    });
    node.runtime.exchange.mockReturnValueOnce({...idle, needsAnotherExchange: true, peers: [peerEvent]});
    node.runtime.exchange
      .mockReturnValueOnce({...idle, needsAnotherExchange: true})
      .mockReturnValueOnce({...idle, needsAnotherExchange: true});
    node.pump.request();
    for (let i = 0; i < 4; i++) await macrotask();
    expect(node.capacities()).toEqual([full, control, control, control]);
    expect(node.host.capacity).toHaveBeenCalledOnce();
    expect(node.host.failed).toHaveBeenCalledExactlyOnceWith(first);
    expect(node.runtime.close).not.toHaveBeenCalled();
  });

  it("closes native at once when the host's failure handler throws", async () => {
    const node = fixture();
    const thrown = new Error("cleanup failed");
    node.host.failed.mockImplementation(() => {
      throw thrown;
    });
    node.host.peers.mockImplementationOnce(() => {
      throw new Error("peer handler failed");
    });
    node.runtime.exchange.mockReturnValueOnce({...idle, peers: [peerEvent]});
    node.pump.request();
    await macrotask();
    expect(node.runtime.close).toHaveBeenCalledOnce();
    expect(node.host.error).toHaveBeenCalledExactlyOnceWith(thrown);
  });

  it("retains serving capacity until serve settles, registered before host code; a failure fails the stream once", async () => {
    const node = fixture();
    const [slow, thrown, rejected, ended] = ["slow", "thrown", "rejected", "ended"].map(incoming);
    ended.retainUntil.mockImplementation(() => {
      throw Object.assign(new Error("NetworkIncomingRetentionInvalid"), {code: "NetworkIncomingRetentionInvalid"});
    });
    const served = Promise.withResolvers<void>();
    const failure = new Error("serving failed");
    node.host.serve
      .mockImplementationOnce((request) => {
        expect(slow.retainUntil).toHaveBeenCalledOnce();
        expect(request.peerId).toBe("peer");
        return served.promise;
      })
      .mockImplementationOnce(() => {
        throw failure;
      })
      .mockImplementationOnce(() => Promise.reject(failure));
    node.runtime.exchange.mockReturnValueOnce({
      ...idle,
      serving: [slow, thrown, rejected, ended],
    });
    node.pump.request();
    await macrotask();
    // A start whose stream ended before adoption is not served.
    expect(node.host.serve).toHaveBeenCalledTimes(3);
    const retirement = (start: Incoming) => {
      let settled = false;
      void start.retainUntil.mock.calls[0][0].then(() => {
        settled = true;
      });
      return () => settled;
    };
    const slowRetired = retirement(slow);
    const thrownRetired = retirement(thrown);
    const rejectedRetired = retirement(rejected);
    await macrotask();
    expect([slowRetired(), thrownRetired(), rejectedRetired()]).toEqual([false, true, true]);
    for (const start of [thrown, rejected]) {
      expect(start.fail).toHaveBeenCalledOnce();
      expect(start.fail.mock.calls[0][0]).toBe(2);
      expect(new TextDecoder().decode(start.fail.mock.calls[0][1])).toBe("Local serving failure");
    }
    expect(node.host.error).toHaveBeenCalledTimes(2);
    expect(slow.fail).not.toHaveBeenCalled();
    const exchanges = node.runtime.exchange.mock.calls.length;
    served.resolve();
    await macrotask();
    expect(slowRetired()).toBe(true);
    // Released capacity drains again.
    await macrotask();
    expect(node.runtime.exchange.mock.calls.length).toBeGreaterThan(exchanges);
    for (const start of [slow, thrown, rejected, ended]) expect(start.cancel).not.toHaveBeenCalled();
  });

  it.each([
    ["capacity read", 0, [], 0, 0, 0, 0],
    ["exchange's settlement", 0, [1, 2, 3], false, 0, 0, 2],
    ["peer handler", 1, [1, 2, 3], false, 0, 0, 2],
    ["first serve", 1, [1, 2, 3], false, 1, 0, 1],
    ["dependency check", 1, [1, 2, 3], true, 2, 0, 0],
    ["urgent validation", 1, [2, 3], true, 2, 1, 0],
    ["ordinary validation", 1, [3], true, 2, 2, 0],
  ] as const)(
    "a close from the host's %s ends the delivery and retires the rest once",
    async (closer, peers, ignored, available, served, validated, cancelled) => {
      const node = fixture();
      const starts = [incoming("first"), incoming("second")];
      const close = (name: string) => {
        if (name === closer) node.pump.stopDelivery();
      };
      node.host.capacity.mockImplementation(() => {
        close("capacity read");
        return {gossipValidation: "ready"};
      });
      node.runtime.exchange.mockImplementationOnce(() => {
        const demand = node.capacities().at(-1);
        close("exchange's settlement");
        if (!demand) return idle;
        return {
          ...idle,
          checks: [check(7)],
          gossip: gossip({messages: [1], urgent: true}, {messages: [2]}, {messages: [3]}),
          peers: [peerEvent],
          serving: starts,
        };
      });
      node.host.peers.mockImplementation(() => close("peer handler"));
      node.host.serve.mockImplementation(() => {
        close("first serve");
        return Promise.resolve();
      });
      node.host.checkDependencies.mockImplementation((checks) => {
        close("dependency check");
        return checks.map(() => true);
      });
      node.host.validate.mockImplementation((job) => {
        close(job.messages[0].data[0] === 1 ? "urgent validation" : "ordinary validation");
        return new Promise(() => undefined);
      });
      node.pump.request();
      await macrotask();
      await macrotask();
      expect(node.host.peers).toHaveBeenCalledTimes(peers);
      expect(node.host.serve).toHaveBeenCalledTimes(served);
      expect(node.host.validate).toHaveBeenCalledTimes(validated);
      expect(starts.map(({cancel}) => cancel.mock.calls.length).reduce((a, b) => a + b)).toBe(cancelled);
      if (served === 1) expect(starts[1].cancel).toHaveBeenCalledOnce();
      expect(node.runtime.reportGossip.mock.calls).toEqual(ignored.map((index) => [handle(index), "ignore"]));
      expect(node.runtime.classifyGossip.mock.calls).toEqual(available === 0 ? [] : [[handle(7), available]]);
      expect(node.capacities().at(-1)).toEqual(control);
    }
  );

  it("stopping delivery leaves already adopted asynchronous work with the host", async () => {
    const node = fixture();
    const start = incoming();
    node.host.serve.mockImplementation(() => new Promise(() => undefined));
    node.host.validate.mockImplementation(() => new Promise(() => undefined));
    node.runtime.exchange.mockReturnValueOnce({
      ...idle,
      gossip: gossip({messages: [1]}),
      serving: [start],
    });
    node.pump.request();
    await macrotask();
    expect(node.host.validate).toHaveBeenCalledOnce();
    expect(node.host.serve).toHaveBeenCalledOnce();
    node.pump.stopDelivery();
    node.pump.stopDelivery();
    await macrotask();
    expect(start.cancel).not.toHaveBeenCalled();
    expect(node.capacities()[1]).toEqual(control);
    node.closed.resolve({reason: "requested"});
    await macrotask();
    expect(start.cancel).not.toHaveBeenCalled();
  });
});

describe("binding pump close results", () => {
  it("reports an owner failure that follows a requested close", async () => {
    const node = fixture();
    const result = node.runtime.closed;
    node.pump.stopDelivery();
    const owner = new Error("owner failed while stopping");
    node.closed.resolve({error: owner, reason: "failed"});
    expect(await result).toEqual({error: owner, reason: "failed"});
  });

  it("reports a delivery failure separately from the requested close", async () => {
    const node = fixture();
    const result = node.runtime.closed;
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    const failure = new Error("peer handler failed");
    node.host.peers.mockImplementation(() => {
      throw failure;
    });
    node.runtime.exchange.mockReturnValueOnce({...idle, peers: [peerEvent]});
    node.pump.request();
    await macrotask();
    expect(node.host.failed).toHaveBeenCalledExactlyOnceWith(failure);
    await macrotask();
    expect(settled).toBe(false);
    node.closed.resolve({reason: "requested"});
    expect(await result).toEqual({reason: "requested"});
  });

  it("finishes delivery cleanup before reporting a host failure, without hiding an owner failure", async () => {
    const node = fixture();
    const result = node.runtime.closed;
    const start = incoming();
    // A real cancellation reaches native, whose wake can record a terminal failure.
    start.cancel.mockImplementation(() => {
      node.runtime.state = "failed";
      return Promise.resolve();
    });
    const failure = new Error("peer handler failed");
    node.host.peers.mockImplementation(() => {
      throw failure;
    });
    node.runtime.exchange.mockReturnValueOnce({
      ...idle,
      peers: [peerEvent],
      serving: [start],
    });
    node.pump.request();
    await macrotask();
    expect(start.cancel).toHaveBeenCalledOnce();
    expect(node.runtime.state).toBe("failed");
    expect(start.cancel.mock.invocationCallOrder[0]).toBeLessThan(node.host.failed.mock.invocationCallOrder[0]);
    expect(node.host.failed).toHaveBeenCalledExactlyOnceWith(failure);
    expect(node.host.error).not.toHaveBeenCalled();
    const owner = new Error("NetworkWakeFailed");
    node.closed.resolve({error: owner, reason: "failed"});
    expect(await result).toEqual({error: owner, reason: "failed"});
  });
});

it("stops log delivery with a final drain when native closes", async () => {
  vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
  const node = fixture();
  node.runtime.drainLogs.mockReturnValue({...noLogs, more: true});
  node.closed.resolve({reason: "requested"});
  await macrotask();
  expect(node.runtime.drainLogs).toHaveBeenCalledTimes(8);
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(2500);
  expect(node.runtime.drainLogs).toHaveBeenCalledTimes(8);
});

it("subscribes before the initial snapshot and keeps recovery reported during that read", async () => {
  const node = fixture();
  let wake: (() => void) | undefined;
  node.host.subscribeCapacity.mockImplementation((notify) => {
    wake = notify;
    return vi.fn();
  });
  node.host.capacity.mockImplementationOnce(() => {
    expect(wake).toBeTypeOf("function");
    wake?.();
    return {gossipValidation: "backpressured"};
  });
  await macrotask();
  await macrotask();
  expect(node.runtime.exchange).toHaveBeenCalledTimes(2);
  expect(node.host.subscribeCapacity).toHaveBeenCalledOnce();
});

it("fails delivery when subscription setup throws while continuing completions", async () => {
  const node = fixture();
  const failure = Error("subscribe failed");
  node.host.subscribeCapacity.mockImplementation(() => {
    throw failure;
  });
  await macrotask();
  expect(node.host.failed).toHaveBeenCalledExactlyOnceWith(failure);
  expect(node.host.capacity).not.toHaveBeenCalled();
  expect(node.capacities()[0]).toEqual(control);
});
