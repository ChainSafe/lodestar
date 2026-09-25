import {generateKeyPair} from "@libp2p/crypto/keys";
import {TopicValidatorResult} from "@libp2p/gossipsub";
import {peerIdFromPublicKey} from "@libp2p/peer-id";
import {describe, expect, it, vi} from "vitest";
import {
  NativeAction,
  NativeExchange,
  NativeExchangeDelivery,
  NativeGossipDependencyCheck,
  NativeGossipMessage,
  NativeNetworkApplicationRuntime,
} from "@chainsafe/lodestar-z/network";
import {createBeaconConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {defer} from "@lodestar/utils";
import {RegistryMetricCreator} from "../../../../src/metrics/utils/registryMetricCreator.js";
import {NativeClaim, NativeDrain, NativeJob} from "../../../../src/network/core/native/drain.js";
import {NativeGossipExecutor} from "../../../../src/network/core/native/executor.js";
import {NativeGossip} from "../../../../src/network/core/native/gossip.js";
import {NetworkEvent, NetworkEventBus} from "../../../../src/network/events.js";
import {GossipType} from "../../../../src/network/gossip/interface.js";
import {stringifyGossipTopic} from "../../../../src/network/gossip/topic.js";
import {defaultNetworkOptions} from "../../../../src/network/options.js";
import {PendingGossipsubMessage} from "../../../../src/network/processor/types.js";
import {isPublishDuplicateError} from "../../../../src/network/util.js";

const config = createBeaconConfig({ALTAIR_FORK_EPOCH: Infinity}, new Uint8Array(32));
const topic = stringifyGossipTopic(config, {
  type: GossipType.voluntary_exit,
  boundary: {fork: ForkName.phase0, epoch: 0},
});
const blockTopic = stringifyGossipTopic(config, {
  type: GossipType.beacon_block,
  boundary: {fork: ForkName.phase0, epoch: 0},
});
const unbounded = {checks: 64, messages: 64, bytes: 16 * 1024 * 1024, deadline: Number.POSITIVE_INFINITY};
const idle: NativeExchangeDelivery = {
  rolledBack: false,
  settled: 0,
  peers: [],
  serving: [],
  checks: [],
  gossip: null,
  retired: false,
  more: false,
  parked: {serving: false, ordinary: false},
  disabledWaiting: false,
  failure: null,
};

type Demand = ReturnType<NativeGossip["demand"]>;

async function fixture(events = new NetworkEventBus(), attach = true, register: RegistryMetricCreator | null = null) {
  const peer = await generateKeyPair("secp256k1");
  let queued: NativeGossipMessage[] = [];
  let checks: NativeGossipDependencyCheck[] = [];
  let grouped = false;
  const ledger = {
    verdict: vi.fn<NativeDrain["verdict"]>(),
    classify: vi.fn<NativeDrain["classify"]>(),
    block: vi.fn<NativeDrain["block"]>(),
    dropQueued: vi.fn<NativeDrain["dropQueued"]>(),
  };
  const publishGossip = vi.fn<NativeNetworkApplicationRuntime["publishGossip"]>(async () => ({
    queued: 1,
    selected: 1,
    unavailable: 0,
    pressured: 0,
    duplicate: false,
  }));
  const runtime = {publishGossip};
  // Like native, claims urgent blocks whenever queued, and ordinary work only while the host claims it and can
  // execute it.
  const claims: NativeClaim<NativeJob>[][] = [];
  const claim = vi.fn((demand: Demand): NativeClaim<NativeJob>[] => {
    const urgent = queued.filter((message) => message.topic === blockTopic);
    const ordinary =
      demand.claimOrdinary && demand.ordinary ? queued.filter((message) => message.topic !== blockTopic) : [];
    const messages = [...urgent, ...ordinary].slice(0, demand.messages);
    queued = queued.filter((message) => !messages.includes(message));
    const jobs: NativeJob[] = grouped
      ? [{kind: "beacon_attestation", grouped: true, urgent: false, messages}]
      : messages.map((message) =>
          message.topic === blockTopic
            ? {kind: "beacon_block", grouped: false, urgent: true, messages: [message]}
            : {kind: "voluntary_exit", grouped: false, urgent: false, messages: [message]}
        );
    const result = messages.length > 0 ? jobs.map((job) => new NativeClaim(job)) : [];
    claims.push(result);
    return result;
  });
  const onError = vi.fn();
  const onFailure = vi.fn();
  const gossip = new NativeGossip(runtime, ledger, config, events, defaultNetworkOptions, onError, onFailure, register);
  const pending: PendingGossipsubMessage[] = [];
  const completions = new Map<PendingGossipsubMessage, ReturnType<typeof defer<TopicValidatorResult>>>();
  const processor = {
    check: vi.fn<NativeGossipExecutor["check"]>((checks) => checks.map(() => true)),
    ready: vi.fn<NativeGossipExecutor["ready"]>(() => true),
    execute: vi.fn<NativeGossipExecutor["execute"]>((messages) => {
      pending.push(...messages);
      return Promise.all(
        messages.map((message) => {
          const completion = defer<TopicValidatorResult>();
          completions.set(message, completion);
          return completion.promise;
        })
      );
    }),
    observe: vi.fn<NativeGossipExecutor["observe"]>(),
  };
  if (attach) gossip.attach(processor);
  /** One turn's gossip: the host's demand, native's checks and claim, and the delivery. */
  const turn = (limits = unbounded): boolean => {
    const demand = gossip.demand(limits, limits.deadline);
    const jobs = demand.messages > 0 ? claim(demand) : [];
    return gossip.deliver(demand.checks > 0 ? checks.splice(0) : [], jobs, limits.deadline);
  };
  return {
    gossip,
    events,
    runtime,
    ledger,
    claim,
    claims,
    turn,
    pending,
    processor,
    onError,
    onFailure,
    async retire(message: PendingGossipsubMessage, result = TopicValidatorResult.Accept): Promise<void> {
      completions.get(message)?.resolve(result);
      await flush();
    },
    /** Adds messages to the native queue. */
    admit(...messages: NativeGossipMessage[]): void {
      queued.push(...messages);
    },
    message(id = 1, messageTopic = topic): NativeGossipMessage {
      return {
        handle: {index: id, generation: (1n << 63n) + BigInt(id)},
        connection: {index: 0, generation: 1},
        peerId: peerIdFromPublicKey(peer.publicKey).toString(),
        topic: messageTopic,
        id: new Uint8Array(20).fill(id),
        data: new Uint8Array(new ArrayBuffer(64), 0, 1),
        receivedAtUnixMs: 12345,
        slot: null,
        attestationData: null,
      };
    },
    drain(messages: NativeGossipMessage[], batchGroup = false, limits = unbounded): boolean {
      queued = messages.slice();
      grouped = batchGroup;
      return turn(limits);
    },
    dependencyChecks(values: NativeGossipDependencyCheck[]): boolean {
      checks = values.slice();
      return turn();
    },
    async close(): Promise<void> {
      gossip.close();
      for (const completion of completions.values()) completion.resolve(TopicValidatorResult.Ignore);
      await flush();
    },
  };
}

describe("native gossip host ownership", () => {
  it("drains once and executes every non-attestation job independently", async () => {
    const node = await fixture();
    try {
      node.drain([node.message(), node.message(2)]);
      expect(node.claim).toHaveBeenCalledOnce();
      expect(node.processor.execute).toHaveBeenCalledTimes(2);
      expect(node.processor.execute.mock.calls.map(([messages]) => messages.length)).toEqual([1, 1]);
      expect(node.pending[0].seenTimestampSec).toBe(12.345);
      await node.retire(node.pending[1], TopicValidatorResult.Reject);
      expect(node.ledger.verdict.mock.calls).toEqual([[node.message(2).handle, "reject"]]);
      await node.retire(node.pending[0]);
      expect(node.ledger.verdict).toHaveBeenLastCalledWith(node.message().handle, "accept");
    } finally {
      await node.close();
    }
  });

  it("starts ordinary jobs until the drain budget and starts the rest before claiming more", async () => {
    const node = await fixture();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const execute = node.processor.execute.getMockImplementation();
    node.processor.execute.mockImplementation((messages, grouped) => {
      now += 5;
      return execute ? execute(messages, grouped) : Promise.resolve([]);
    });
    try {
      const limits = {checks: 64, messages: 64, bytes: 8 * 1024 * 1024, deadline: 8};
      expect(node.drain([node.message(), node.message(2), node.message(3)], false, limits)).toBe(true);
      expect(node.processor.execute).toHaveBeenCalledTimes(2);
      expect(node.claim).toHaveBeenCalledExactlyOnceWith({
        checks: 64,
        messages: 64,
        bytes: 8 * 1024 * 1024,
        claimOrdinary: true,
        ordinary: true,
      });
      // Every delivered job was adopted: started or held.
      expect(node.claims.flat().every(({adopted}) => adopted)).toBe(true);
      node.admit(node.message(4));
      // One queued job starts even past the budget; native ordinary work waits for the queue to empty.
      expect(node.turn({...limits, deadline: now})).toBe(false);
      expect(node.processor.execute).toHaveBeenCalledTimes(3);
      expect(node.claim).toHaveBeenLastCalledWith(expect.objectContaining({claimOrdinary: false}));
      expect(node.claim).toHaveLastReturnedWith([]);
      expect(node.turn({...limits, deadline: now + 8})).toBe(false);
      expect(node.processor.execute).toHaveBeenCalledTimes(4);
      expect(node.claim).toHaveLastReturnedWith([expect.anything()]);
      for (const message of node.pending.slice()) await node.retire(message);
      expect(node.ledger.verdict).toHaveBeenCalledTimes(4);
    } finally {
      vi.restoreAllMocks();
      await node.close();
    }
  });

  it("starts every claimed urgent job in one drain past the budget while ordinary jobs yield at it", async () => {
    const node = await fixture();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const execute = node.processor.execute.getMockImplementation();
    node.processor.execute.mockImplementation((messages, grouped) => {
      now += 5;
      return execute ? execute(messages, grouped) : Promise.resolve([]);
    });
    try {
      const limits = {checks: 64, messages: 64, bytes: 8 * 1024 * 1024, deadline: 8};
      const ordinary = [node.message(), node.message(2), node.message(3)];
      const urgent = [4, 5, 6].map((id) => node.message(id, blockTopic));
      expect(node.drain([...ordinary, ...urgent], false, limits)).toBe(true);
      // All three blocks start although the first spends the budget; then one ordinary job starts.
      expect(node.processor.execute).toHaveBeenCalledTimes(4);
      expect(node.pending.map(({msgId}) => msgId)).toEqual(
        [...urgent, ordinary[0]].map(({id}) => Buffer.from(id).toString("hex"))
      );
      // Urgent work is claimed while ordinary jobs wait, and ordinary work is not claimed for the queue.
      node.admit(node.message(7, blockTopic), node.message(8));
      expect(node.turn({...limits, deadline: now})).toBe(true);
      expect(node.claim).toHaveBeenLastCalledWith({
        ...limits,
        deadline: undefined,
        claimOrdinary: false,
        ordinary: true,
      });
      expect(node.processor.execute).toHaveBeenCalledTimes(6);
      expect(node.pending.at(-2)?.topic.type).toBe(GossipType.beacon_block);
      // The next turn starts the last queued job; the one after claims the ordinary work.
      expect(node.turn({...limits, deadline: now + 8})).toBe(false);
      expect(node.claim).toHaveLastReturnedWith([]);
      expect(node.turn({...limits, deadline: now + 8})).toBe(false);
      expect(node.claim).toHaveBeenLastCalledWith({
        ...limits,
        deadline: undefined,
        claimOrdinary: true,
        ordinary: true,
      });
      expect(node.processor.execute).toHaveBeenCalledTimes(8);
      for (const message of node.pending.slice()) await node.retire(message);
      expect(node.ledger.verdict).toHaveBeenCalledTimes(8);
    } finally {
      vi.restoreAllMocks();
      await node.close();
    }
  });

  it("defers newly claimed ordinary jobs when earlier work in the drain spent its budget", async () => {
    const node = await fixture();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    try {
      node.admit(node.message(), node.message(2, blockTopic));
      const limits = {checks: 64, messages: 64, bytes: 8 * 1024 * 1024};
      const demand = node.gossip.demand(limits, 8);
      expect(demand).toMatchObject({claimOrdinary: true, ordinary: true});
      const jobs = node.claim(demand);
      // Settlement, peers and serving ran past the 8 ms deadline before gossip delivery at 9 ms.
      now = 9;
      expect(node.gossip.deliver([], jobs, 8)).toBe(true);
      expect(node.pending.map(({topic}) => topic.type)).toEqual([GossipType.beacon_block]);
      // The next turn starts the held job whatever its budget, so held work progresses.
      expect(node.turn({...limits, deadline: now})).toBe(false);
      expect(node.pending.map(({topic}) => topic.type)).toEqual([GossipType.beacon_block, GossipType.voluntary_exit]);
    } finally {
      vi.restoreAllMocks();
      await node.close();
    }
  });

  it("dispatches a claimed message larger than the drain byte cap", async () => {
    const node = await fixture();
    try {
      const limits = {checks: 64, messages: 64, bytes: 8 * 1024 * 1024, deadline: Number.POSITIVE_INFINITY};
      const block = {...node.message(1, blockTopic), data: new Uint8Array(9 * 1024 * 1024)};
      expect(node.drain([block], false, limits)).toBe(false);
      expect(node.claim).toHaveBeenCalledExactlyOnceWith({
        checks: 64,
        messages: 64,
        bytes: limits.bytes,
        claimOrdinary: true,
        ordinary: true,
      });
      expect(node.pending.map(({msg}) => msg.data.length)).toEqual([9 * 1024 * 1024]);
      await node.retire(node.pending[0]);
      expect(node.ledger.verdict).toHaveBeenCalledExactlyOnceWith(block.handle, "accept");
    } finally {
      await node.close();
    }
  });

  it("reports the executor's readiness as ordinary capacity and claims ordinary work only with it", async () => {
    const node = await fixture();
    try {
      node.processor.ready.mockReturnValue(false);
      node.admit(node.message());
      expect(node.turn()).toBe(false);
      expect(node.claim).toHaveBeenLastCalledWith(expect.objectContaining({claimOrdinary: true, ordinary: false}));
      expect(node.pending).toHaveLength(0);
      node.processor.ready.mockReturnValue(true);
      expect(node.turn()).toBe(false);
      expect(node.claim).toHaveBeenLastCalledWith(expect.objectContaining({claimOrdinary: true, ordinary: true}));
      expect(node.pending).toHaveLength(1);
    } finally {
      await node.close();
    }
  });

  it("classifies every check unavailable when the executor cannot answer them", async () => {
    const node = await fixture();
    const failure = new Error("check failed");
    node.processor.check.mockImplementationOnce(() => {
      throw failure;
    });
    const checks = [1, 2].map((id) => ({
      handle: node.message(id).handle,
      root: new Uint8Array(32),
      slot: 1n,
      peerId: node.message(id).peerId,
      topic,
    }));
    try {
      node.dependencyChecks(checks);
      expect(node.ledger.classify.mock.calls).toEqual(checks.map(({handle}) => [handle, false]));
      expect(node.onError).toHaveBeenCalledExactlyOnceWith(failure);
    } finally {
      await node.close();
    }
  });

  it("classifies dependency answers in one call", async () => {
    const node = await fixture();
    const checks = [1, 2].map((id) => ({
      handle: node.message(id).handle,
      root: new Uint8Array(32),
      slot: 1n,
      peerId: node.message(id).peerId,
      topic,
    }));
    try {
      expect(node.dependencyChecks(checks)).toBe(false);
      expect(node.processor.check).toHaveBeenCalledWith(checks);
      expect(node.ledger.classify.mock.calls).toEqual(checks.map(({handle}) => [handle, true]));
      expect(node.processor.execute).not.toHaveBeenCalled();
    } finally {
      await node.close();
    }
  });

  it("measures a checked message's delay from its dependency check to its job's dispatch", async () => {
    const register = new RegistryMetricCreator();
    const node = await fixture(undefined, true, register);
    try {
      // Native claims a classified message in the exchange that carries its classification.
      const message = node.message();
      node.dependencyChecks([
        {handle: message.handle, root: new Uint8Array(32), slot: 1n, peerId: message.peerId, topic},
      ]);
      node.admit(message);
      node.turn();
      expect(await register.getSingleMetricAsString("lodestar_native_gossip_check_to_dispatch_seconds")).toContain(
        'lodestar_native_gossip_check_to_dispatch_seconds_count{kind="voluntary_exit"} 1'
      );
    } finally {
      await node.close();
    }
  });

  it("waits for an executor before acquiring native work", async () => {
    const node = await fixture(undefined, false);
    try {
      node.drain([node.message()]);
      expect(node.claim).not.toHaveBeenCalled();
      node.gossip.attach(node.processor);
      node.turn();
      expect(node.pending).toHaveLength(1);
      expect(() => node.gossip.attach(node.processor)).toThrow("gossip executor attachment");
    } finally {
      await node.close();
    }
  });

  it("retires the whole copied batch when preparation fails", async () => {
    const node = await fixture();
    const messages = [node.message(), {...node.message(2), topic: "/invalid"}, node.message(3)];
    try {
      node.drain(messages);
      await flush();
      expect(node.processor.execute).not.toHaveBeenCalled();
      expect(node.onError).toHaveBeenCalledOnce();
      expect(node.ledger.verdict.mock.calls).toEqual(messages.map(({handle}) => [handle, "ignore"]));
      node.drain([node.message(4)]);
      expect(node.pending).toHaveLength(1);
    } finally {
      await node.close();
    }
  });

  it.each(["throw", "reject"])(
    "retires the entire validation group when its executor fails with %s",
    async (failure) => {
      const node = await fixture();
      const error = new Error("executor failed");
      node.processor.execute.mockImplementationOnce(() => {
        if (failure === "throw") throw error;
        return Promise.reject(error);
      });
      try {
        node.drain([node.message(), node.message(2)], true);
        await flush();
        expect(node.ledger.verdict.mock.calls).toEqual([
          [node.message().handle, "ignore"],
          [node.message(2).handle, "ignore"],
        ]);
        expect(node.onError).toHaveBeenCalledWith(error);
        expect(node.onFailure).not.toHaveBeenCalled();
      } finally {
        await node.close();
      }
    }
  );

  it("reports completion only after the task settles, even after early events and protocol expiry", async () => {
    const node = await fixture();
    try {
      node.drain([node.message()]);
      const message = node.pending[0];
      node.events.emit(NetworkEvent.gossipMessageValidationResult, {
        msgId: message.msgId,
        propagationSource: message.propagationSource,
        acceptance: TopicValidatorResult.Accept,
      });
      expect(node.ledger.verdict).not.toHaveBeenCalled();
      await node.retire(message);
      await node.retire(message);
      expect(node.ledger.verdict).toHaveBeenCalledExactlyOnceWith(node.message().handle, "accept");
    } finally {
      await node.close();
    }
  });

  it("retires every group handle before invoking throwing observers", async () => {
    const node = await fixture();
    const observer = vi.fn(() => {
      expect(node.ledger.verdict).toHaveBeenCalledTimes(2);
      throw new Error("observer failed");
    });
    node.processor.observe.mockImplementation(observer);
    node.events.on(NetworkEvent.gossipMessageValidationResult, observer);
    try {
      node.drain([node.message(), node.message(2)], true);
      await node.retire(node.pending[0]);
      expect(node.ledger.verdict).not.toHaveBeenCalled();
      await node.retire(node.pending[1], TopicValidatorResult.Reject);
      expect(node.ledger.verdict.mock.calls).toEqual([
        [node.message().handle, "accept"],
        [node.message(2).handle, "reject"],
      ]);
      expect(observer).toHaveBeenCalledTimes(3);
      expect(node.onError).toHaveBeenCalledWith(expect.any(AggregateError));
      expect(node.onFailure).not.toHaveBeenCalled();
    } finally {
      await node.close();
    }
  });

  it("attempts every completion when a native report throws", async () => {
    const node = await fixture();
    const error = new Error("native report failed");
    node.ledger.verdict.mockImplementationOnce(() => {
      throw error;
    });
    try {
      node.drain([node.message(), node.message(2)], true);
      await node.retire(node.pending[0]);
      await node.retire(node.pending[1]);
      expect(node.ledger.verdict).toHaveBeenCalledTimes(2);
      expect(node.onFailure).toHaveBeenCalledWith(error);
      expect(node.onError).not.toHaveBeenCalled();
    } finally {
      await node.close();
    }
  });

  it("completes by handle even when validation transfers the backing buffer", async () => {
    const node = await fixture();
    try {
      const input = node.message();
      node.drain([input]);
      structuredClone(input.data.buffer, {transfer: [input.data.buffer]});
      await node.retire(node.pending[0]);
      expect(node.ledger.verdict).toHaveBeenCalledWith(input.handle, "accept");
      expect(node.onError).not.toHaveBeenCalled();
    } finally {
      await node.close();
    }
  });

  it("keeps a job the host adopted and started when its handler throws, and reports it once", async () => {
    const node = await fixture();
    const message = node.message(9, blockTopic);
    const failure = new Error("handler failed after adoption");
    const exchange = vi.fn((_actions: readonly NativeAction[], _demand: unknown): NativeExchange => idle);
    exchange.mockReturnValueOnce({
      ...idle,
      gossip: {messages: [message], jobs: [{kind: "beacon_block", start: 0, length: 1, grouped: false, urgent: true}]},
    });
    const pump = new NativeDrain(
      {exchange, fail: vi.fn<NativeNetworkApplicationRuntime["fail"]>(), closed: new Promise(() => {})},
      {budgetMs: 8, settle: 32, peers: 32, checks: 64, servingStarts: 8, gossipItems: 64, gossipBytes: 1 << 20},
      () => ({
        demand: () => ({
          bytes: 1 << 20,
          capacity: null,
          checks: 64,
          claimOrdinary: true,
          messages: 64,
          peers: 32,
          servingStarts: 8,
        }),
        deliver: ({checks, jobs}, deadline) => {
          node.gossip.deliver(checks, jobs, deadline);
          throw failure;
        },
      }),
      node.onFailure,
      null
    );
    node.ledger.verdict.mockImplementation((handle, verdict) => pump.verdict(handle, verdict));
    try {
      pump.request();
      await flush();
      expect(node.onFailure).toHaveBeenCalledExactlyOnceWith(failure);
      expect(node.pending).toHaveLength(1);
      await flush();
      // No early ignore: the adopted task still owns the message.
      expect(exchange.mock.calls.flatMap(([actions]) => actions)).toEqual([]);
      await node.retire(node.pending[0]);
      await flush();
      expect(exchange.mock.calls.flatMap(([actions]) => actions)).toEqual([
        {handle: message.handle, type: "verdict", verdict: "accept"},
      ]);
    } finally {
      await node.close();
    }
  });

  it("lets a running task finish after terminal close without calling the stopped runtime", async () => {
    const node = await fixture();
    try {
      node.drain([node.message()]);
      node.gossip.close();
      await node.retire(node.pending[0]);
      expect(node.ledger.verdict).not.toHaveBeenCalled();
    } finally {
      await node.close();
    }
  });

  it("preserves publication options and the existing duplicate error contract", async () => {
    const node = await fixture();
    try {
      const data = new Uint8Array(112);
      expect(
        await node.gossip.publish(topic, data, {
          floodPublish: true,
          allowPublishToZeroTopicPeers: true,
          ignoreDuplicatePublishError: true,
        })
      ).toBe(1);
      expect(node.runtime.publishGossip).toHaveBeenCalledWith(topic, data, {
        flood: true,
        allowZeroPeers: true,
        ignoreDuplicate: true,
      });
      node.runtime.publishGossip.mockRejectedValueOnce(
        Object.assign(new Error("duplicate"), {code: "NetworkGossipPublishFailed", reason: "duplicate"})
      );
      const error = await node.gossip.publish(topic, data).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(Error);
      expect(isPublishDuplicateError(error as Error)).toBe(true);
    } finally {
      await node.close();
    }
  });

  it("retries admission pressure after yielding, with the same bytes and options", async () => {
    const node = await fixture();
    try {
      const pressure = Object.assign(new Error("full"), {code: "NetworkGossipPublishFailed", reason: "admission_full"});
      node.runtime.publishGossip.mockRejectedValueOnce(pressure).mockRejectedValueOnce(pressure);
      const data = new Uint8Array(112);
      const published = node.gossip.publish(topic, data, {floodPublish: true});
      await Promise.resolve();
      expect(node.runtime.publishGossip).toHaveBeenCalledTimes(1);
      expect(await published).toBe(1);
      expect(node.runtime.publishGossip).toHaveBeenCalledTimes(3);
      for (const call of node.runtime.publishGossip.mock.calls) {
        expect(call[1]).toBe(data);
        expect(call[2]).toEqual(node.runtime.publishGossip.mock.calls[0][2]);
      }
    } finally {
      await node.close();
    }
  });

  it("does not retry protocol resource exhaustion or a completed publication under peer pressure", async () => {
    const node = await fixture();
    try {
      const failure = Object.assign(new Error("full"), {
        code: "NetworkGossipPublishFailed",
        reason: "resource_exhausted",
      });
      node.runtime.publishGossip.mockRejectedValueOnce(failure);
      await expect(node.gossip.publish(topic, new Uint8Array(112))).rejects.toBe(failure);
      expect(node.runtime.publishGossip).toHaveBeenCalledTimes(1);
      node.runtime.publishGossip.mockResolvedValueOnce({
        queued: 1,
        selected: 3,
        pressured: 2,
        unavailable: 0,
        duplicate: false,
      });
      expect(await node.gossip.publish(topic, new Uint8Array(112))).toBe(1);
      expect(node.runtime.publishGossip).toHaveBeenCalledTimes(2);
    } finally {
      await node.close();
    }
  });

  it("terminates a waiting publication on close", async () => {
    const node = await fixture();
    try {
      node.runtime.publishGossip.mockRejectedValue(
        Object.assign(new Error("full"), {
          code: "NetworkGossipPublishFailed",
          reason: "admission_full",
        })
      );
      const published = node.gossip.publish(topic, new Uint8Array(112));
      await Promise.resolve();
      node.gossip.close();
      await expect(published).rejects.toMatchObject({type: {code: "NATIVE_NETWORK_CLOSED"}});
      expect(node.runtime.publishGossip).toHaveBeenCalledTimes(1);
    } finally {
      await node.close();
    }
  });

  it("fails explicitly if admission remains blocked for a slot", async () => {
    const node = await fixture();
    const now = vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(config.SLOT_DURATION_MS);
    try {
      const pressure = Object.assign(new Error("full"), {code: "NetworkGossipPublishFailed", reason: "admission_full"});
      node.runtime.publishGossip.mockRejectedValue(pressure);
      await expect(node.gossip.publish(topic, new Uint8Array(112))).rejects.toBe(pressure);
      expect(node.runtime.publishGossip).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
      await node.close();
    }
  });
});

import {setImmediate as flush} from "node:timers/promises";
