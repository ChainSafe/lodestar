import {generateKeyPair} from "@libp2p/crypto/keys";
import {TopicValidatorResult} from "@libp2p/gossipsub";
import {peerIdFromPublicKey} from "@libp2p/peer-id";
import {describe, expect, it, vi} from "vitest";
import {
  NativeGossipDependencyCheck,
  NativeGossipMessage,
  NativeNetworkApplicationRuntime,
} from "@chainsafe/lodestar-z/network";
import {createBeaconConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {defer} from "@lodestar/utils";
import {RegistryMetricCreator} from "../../../../src/metrics/utils/registryMetricCreator.js";
import {nativeLanes} from "../../../../src/network/core/native/drain.js";
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
const unbounded = {items: 64, bytes: 16 * 1024 * 1024, deadline: Number.POSITIVE_INFINITY};

async function fixture(events = new NetworkEventBus(), attach = true, register: RegistryMetricCreator | null = null) {
  const peer = await generateKeyPair("secp256k1");
  let queued: NativeGossipMessage[] = [];
  let checks: NativeGossipDependencyCheck[] = [];
  let grouped = false;
  let more = false;
  const reportGossip = vi.fn<NativeNetworkApplicationRuntime["reportGossip"]>(() => true);
  const publishGossip = vi.fn<NativeNetworkApplicationRuntime["publishGossip"]>(async () => ({
    queued: 1,
    selected: 1,
    unavailable: 0,
    pressured: 0,
    duplicate: false,
  }));
  // Like native, claims urgent blocks first and ordinary work only while the ordinary gate is open.
  const runtime = {
    drainGossip: vi.fn<NativeNetworkApplicationRuntime["drainGossip"]>((demand) => {
      const urgent = queued.filter((message) => message.topic === blockTopic);
      const ordinary = demand?.ordinary === false ? [] : queued.filter((message) => message.topic !== blockTopic);
      const messages = [...urgent, ...ordinary].slice(0, demand?.items ?? 64);
      queued = queued.filter((message) => !messages.includes(message));
      const jobs = grouped
        ? [{kind: "beacon_attestation" as const, start: 0, length: messages.length, grouped: true, urgent: false}]
        : messages.map((message, start) =>
            message.topic === blockTopic
              ? {kind: "beacon_block" as const, start, length: 1, grouped: false, urgent: true}
              : {kind: "voluntary_exit" as const, start, length: 1, grouped: false, urgent: false}
          );
      return {messages, jobs: messages.length > 0 ? jobs : [], more};
    }),
    reportGossip,
    publishGossip,
    drainGossipChecks: vi.fn<NativeNetworkApplicationRuntime["drainGossipChecks"]>(() => checks.splice(0)),
    classifyGossip: vi.fn<NativeNetworkApplicationRuntime["classifyGossip"]>((answers) => answers.length),
    notifyGossipBlock: () => {},
    dropQueuedGossip: () => {},
    trackGossipSearch: () => true,
  };
  const onError = vi.fn();
  const onFailure = vi.fn();
  const gossip = new NativeGossip(runtime, config, events, defaultNetworkOptions, onError, onFailure, register);
  const pending: PendingGossipsubMessage[] = [];
  const completions = new Map<PendingGossipsubMessage, ReturnType<typeof defer<TopicValidatorResult>>>();
  const processor = {
    check: vi.fn<NativeGossipExecutor["check"]>((checks) => checks.map(({handle}) => ({handle, available: true}))),
    canExecute: vi.fn<NativeGossipExecutor["canExecute"]>(() => true),
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
  /** The gossip lanes native would report for the queued messages and checks. */
  const lanes = (): number =>
    (queued.some((message) => message.topic === blockTopic) ? nativeLanes.gossipUrgent : 0) |
    (queued.some((message) => message.topic !== blockTopic) ? nativeLanes.gossipOrdinary : 0) |
    (checks.length > 0 ? nativeLanes.gossipChecks : 0);
  return {
    gossip,
    events,
    runtime,
    pending,
    processor,
    onError,
    onFailure,
    async retire(message: PendingGossipsubMessage, result = TopicValidatorResult.Accept): Promise<void> {
      completions.get(message)?.resolve(result);
      await flush();
    },
    lanes,
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
      return gossip.drain({...limits, lanes: lanes()});
    },
    dependencyChecks(values: NativeGossipDependencyCheck[], immediate = false): boolean {
      checks = values.slice();
      more = immediate;
      return gossip.drain({...unbounded, lanes: lanes()});
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
      expect(node.runtime.drainGossip).toHaveBeenCalledOnce();
      expect(node.processor.execute).toHaveBeenCalledTimes(2);
      expect(node.processor.execute.mock.calls.map(([messages]) => messages.length)).toEqual([1, 1]);
      expect(node.pending[0].seenTimestampSec).toBe(12.345);
      await node.retire(node.pending[1], TopicValidatorResult.Reject);
      expect(node.runtime.reportGossip.mock.calls).toEqual([[node.message(2).handle, "reject"]]);
      await node.retire(node.pending[0]);
      expect(node.runtime.reportGossip).toHaveBeenLastCalledWith(node.message().handle, "accept");
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
      const limits = {items: 64, bytes: 8 * 1024 * 1024, deadline: 8};
      expect(node.drain([node.message(), node.message(2), node.message(3)], false, limits)).toBe(true);
      expect(node.processor.execute).toHaveBeenCalledTimes(2);
      expect(node.runtime.drainGossip).toHaveBeenCalledExactlyOnceWith({
        items: 64,
        bytes: 8 * 1024 * 1024,
        ordinary: true,
      });
      node.admit(node.message(4));
      // One queued job starts even past the budget; native ordinary work waits for the queue to empty.
      expect(node.gossip.drain({...limits, deadline: now, lanes: node.lanes()})).toBe(true);
      expect(node.processor.execute).toHaveBeenCalledTimes(3);
      expect(node.runtime.drainGossip).toHaveBeenCalledOnce();
      expect(node.gossip.drain({...limits, deadline: now + 8, lanes: node.lanes()})).toBe(false);
      expect(node.processor.execute).toHaveBeenCalledTimes(4);
      expect(node.runtime.drainGossip).toHaveBeenCalledTimes(2);
      for (const message of node.pending.slice()) await node.retire(message);
      expect(node.runtime.reportGossip).toHaveBeenCalledTimes(4);
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
      const limits = {items: 64, bytes: 8 * 1024 * 1024, deadline: 8};
      const ordinary = [node.message(), node.message(2), node.message(3)];
      const urgent = [4, 5, 6].map((id) => node.message(id, blockTopic));
      expect(node.drain([...ordinary, ...urgent], false, limits)).toBe(true);
      // All three blocks start although the first spends the budget; then one ordinary job starts.
      expect(node.processor.execute).toHaveBeenCalledTimes(4);
      expect(node.pending.map(({msgId}) => msgId)).toEqual(
        [...urgent, ordinary[0]].map(({id}) => Buffer.from(id).toString("hex"))
      );
      // Urgent work is claimed while ordinary jobs wait, with native's ordinary gate closed for the queue.
      node.admit(node.message(7, blockTopic), node.message(8));
      expect(node.gossip.drain({...limits, deadline: now, lanes: node.lanes()})).toBe(true);
      expect(node.runtime.drainGossip).toHaveBeenLastCalledWith({items: 64, bytes: 8 * 1024 * 1024, ordinary: false});
      expect(node.processor.execute).toHaveBeenCalledTimes(6);
      expect(node.pending.at(-2)?.topic.type).toBe(GossipType.beacon_block);
      // The next drain starts the last queued job; the one after reopens the gate and claims the ordinary work.
      expect(node.gossip.drain({...limits, deadline: now + 8, lanes: node.lanes()})).toBe(true);
      expect(node.runtime.drainGossip).toHaveBeenCalledTimes(2);
      expect(node.gossip.drain({...limits, deadline: now + 8, lanes: node.lanes()})).toBe(false);
      expect(node.runtime.drainGossip).toHaveBeenLastCalledWith({items: 64, bytes: 8 * 1024 * 1024, ordinary: true});
      expect(node.processor.execute).toHaveBeenCalledTimes(8);
      for (const message of node.pending.slice()) await node.retire(message);
      expect(node.runtime.reportGossip).toHaveBeenCalledTimes(8);
    } finally {
      vi.restoreAllMocks();
      await node.close();
    }
  });

  it("dispatches a claimed message larger than the drain byte cap", async () => {
    const node = await fixture();
    try {
      const limits = {items: 64, bytes: 8 * 1024 * 1024, deadline: Number.POSITIVE_INFINITY};
      const block = {...node.message(1, blockTopic), data: new Uint8Array(9 * 1024 * 1024)};
      expect(node.drain([block], false, limits)).toBe(false);
      expect(node.runtime.drainGossip).toHaveBeenCalledExactlyOnceWith({
        items: 64,
        bytes: limits.bytes,
        ordinary: true,
      });
      expect(node.pending.map(({msg}) => msg.data.length)).toEqual([9 * 1024 * 1024]);
      await node.retire(node.pending[0]);
      expect(node.runtime.reportGossip).toHaveBeenCalledExactlyOnceWith(block.handle, "accept");
    } finally {
      await node.close();
    }
  });

  it("calls no native lane without work and closes the ordinary gate once while the executor is busy", async () => {
    const node = await fixture();
    try {
      expect(node.gossip.drain({...unbounded, lanes: 0})).toBe(false);
      expect(node.runtime.drainGossipChecks).not.toHaveBeenCalled();
      expect(node.runtime.drainGossip).not.toHaveBeenCalled();
      expect(node.processor.canExecute).not.toHaveBeenCalled();
      node.processor.canExecute.mockReturnValue(false);
      node.admit(node.message());
      expect(node.gossip.drain({...unbounded, lanes: node.lanes()})).toBe(false);
      expect(node.runtime.drainGossip).toHaveBeenCalledExactlyOnceWith({
        items: 64,
        bytes: 16 * 1024 * 1024,
        ordinary: false,
      });
      expect(node.gossip.drain({...unbounded, lanes: node.lanes()})).toBe(false);
      expect(node.runtime.drainGossip).toHaveBeenCalledOnce();
      node.processor.canExecute.mockReturnValue(true);
      expect(node.gossip.drain({...unbounded, lanes: node.lanes()})).toBe(false);
      expect(node.runtime.drainGossip).toHaveBeenLastCalledWith({items: 64, bytes: 16 * 1024 * 1024, ordinary: true});
      expect(node.pending).toHaveLength(1);
    } finally {
      await node.close();
    }
  });

  it("classifies dependency answers in one call and continues a check-only turn", async () => {
    const node = await fixture();
    const checks = [1, 2].map((id) => ({
      handle: node.message(id).handle,
      root: new Uint8Array(32),
      slot: 1n,
      peerId: node.message(id).peerId,
      topic,
    }));
    try {
      expect(node.dependencyChecks(checks, true)).toBe(true);
      expect(node.processor.check).toHaveBeenCalledWith(checks);
      expect(node.runtime.classifyGossip).toHaveBeenCalledExactlyOnceWith(
        checks.map(({handle}) => ({handle, available: true}))
      );
      expect(node.runtime.drainGossip).toHaveBeenCalledOnce();
      expect(node.processor.execute).not.toHaveBeenCalled();
    } finally {
      await node.close();
    }
  });

  it("measures a checked message's delay from its dependency check to its job's dispatch", async () => {
    const register = new RegistryMetricCreator();
    const node = await fixture(undefined, true, register);
    try {
      const message = node.message();
      node.admit(message);
      node.dependencyChecks([
        {handle: message.handle, root: new Uint8Array(32), slot: 1n, peerId: message.peerId, topic},
      ]);
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
      expect(node.runtime.drainGossip).not.toHaveBeenCalled();
      node.gossip.attach(node.processor);
      node.gossip.drain({...unbounded, lanes: node.lanes()});
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
      expect(node.runtime.reportGossip.mock.calls).toEqual(messages.map(({handle}) => [handle, "ignore"]));
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
        expect(node.runtime.reportGossip.mock.calls).toEqual([
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
      expect(node.runtime.reportGossip).not.toHaveBeenCalled();
      node.runtime.reportGossip.mockReturnValue(false);
      await node.retire(message);
      await node.retire(message);
      expect(node.runtime.reportGossip).toHaveBeenCalledExactlyOnceWith(node.message().handle, "accept");
    } finally {
      await node.close();
    }
  });

  it("retires every group handle before invoking throwing observers", async () => {
    const node = await fixture();
    const observer = vi.fn(() => {
      expect(node.runtime.reportGossip).toHaveBeenCalledTimes(2);
      throw new Error("observer failed");
    });
    node.processor.observe.mockImplementation(observer);
    node.events.on(NetworkEvent.gossipMessageValidationResult, observer);
    try {
      node.drain([node.message(), node.message(2)], true);
      await node.retire(node.pending[0]);
      expect(node.runtime.reportGossip).not.toHaveBeenCalled();
      await node.retire(node.pending[1], TopicValidatorResult.Reject);
      expect(node.runtime.reportGossip.mock.calls).toEqual([
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
    node.runtime.reportGossip.mockImplementationOnce(() => {
      throw error;
    });
    try {
      node.drain([node.message(), node.message(2)], true);
      await node.retire(node.pending[0]);
      await node.retire(node.pending[1]);
      expect(node.runtime.reportGossip).toHaveBeenCalledTimes(2);
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
      expect(node.runtime.reportGossip).toHaveBeenCalledWith(input.handle, "accept");
      expect(node.onError).not.toHaveBeenCalled();
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
      expect(node.runtime.reportGossip).not.toHaveBeenCalled();
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
