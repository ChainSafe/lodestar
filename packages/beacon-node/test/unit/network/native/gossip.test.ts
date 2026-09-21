import {generateKeyPair} from "@libp2p/crypto/keys";
import {TopicValidatorResult} from "@libp2p/gossipsub";
import {peerIdFromPublicKey} from "@libp2p/peer-id";
import {describe, expect, it, vi} from "vitest";
import {NativeGossipMessage, NativeNetworkApplicationRuntime} from "@chainsafe/lodestar-z/network";
import {createBeaconConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {defer} from "@lodestar/utils";
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

async function fixture(events = new NetworkEventBus(), hostGossipItems = 1, attach = true) {
  const peer = await generateKeyPair("secp256k1");
  let queued: NativeGossipMessage[] = [];
  const reportGossip = vi.fn<NativeNetworkApplicationRuntime["reportGossip"]>(() => true);
  const publishGossip = vi.fn<NativeNetworkApplicationRuntime["publishGossip"]>(async () => ({
    queued: 1,
    selected: 1,
    unavailable: 0,
    pressured: 0,
    duplicate: false,
  }));
  const runtime = {
    drainGossip: () => ({messages: queued.splice(0), more: false, grouped: false}),
    reportGossip,
    publishGossip,
    drainGossipChecks: () => [],
    classifyGossip: () => true,
    notifyGossipBlock: () => {},
    dropQueuedGossip: () => {},
    trackGossipSearch: () => true,
  };
  const opts = {...defaultNetworkOptions, native: {hostGossipItems, hostGossipBytes: hostGossipItems * 64}};
  const onError = vi.fn();
  const gossip = new NativeGossip(runtime, config, events, opts, onError);
  const pending: PendingGossipsubMessage[] = [];
  const completions = new Map<PendingGossipsubMessage, ReturnType<typeof defer<TopicValidatorResult>>>();
  const processor = {
    check: () => true,
    canExecute: () => true,
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
  const wake = vi.fn();
  if (attach) gossip.attach(processor, wake);
  const retire = async (message: PendingGossipsubMessage, result = TopicValidatorResult.Accept): Promise<void> => {
    completions.get(message)?.resolve(result);
    await flush();
  };
  return {
    gossip,
    events,
    runtime,
    opts,
    pending,
    retire,
    processor,
    onError,
    wake,
    message(id = 1): NativeGossipMessage {
      return {
        handle: {index: 0, generation: (1n << 63n) + BigInt(id)},
        connection: {index: 0, generation: 1},
        peerId: peerIdFromPublicKey(peer.publicKey).toString(),
        topic,
        id: new Uint8Array(20).fill(id),
        data: new Uint8Array(new ArrayBuffer(64), 0, 1),
        receivedAtUnixMs: 12345,
        slot: null,
        attestationData: null,
      };
    },
    drain(...messages: NativeGossipMessage[]): void {
      queued = messages;
      gossip.drain();
    },
    async close(): Promise<void> {
      gossip.close();
      for (const completion of completions.values()) completion.resolve(TopicValidatorResult.Ignore);
      await flush();
    },
  };
}

describe("native gossip host ownership", () => {
  it("wakes the replacement runtime when an older runtime returns execution credit", async () => {
    const old = await fixture();
    const next = await fixture();
    try {
      old.drain(old.message());
      old.gossip.close();
      expect(next.gossip.snapshot().items).toBe(1);
      await old.retire(old.pending[0]);
      expect(next.wake).toHaveBeenCalledOnce();
      expect(next.gossip.snapshot().items).toBe(0);
    } finally {
      await old.close();
      await next.close();
    }
  });
  it("keeps existing idle instances on the shared budget after an allowed policy change", async () => {
    const old = await fixture();
    const next = await fixture(undefined, 2);
    try {
      old.drain(old.message());
      next.drain(next.message(2), next.message(3));
      expect(old.pending).toHaveLength(1);
      expect(next.pending).toHaveLength(1);
      expect(old.gossip.snapshot()).toMatchObject({items: 2, bytes: 128});
      expect(next.gossip.snapshot()).toMatchObject({items: 2, bytes: 128});
      expect(next.runtime.reportGossip).toHaveBeenCalledWith(next.message(3).handle, "ignore");
      expect(
        () =>
          new NativeGossip(
            next.runtime,
            config,
            new NetworkEventBus(),
            {
              ...next.opts,
              native: {hostGossipItems: 3, hostGossipBytes: 192},
            },
            next.onError
          )
      ).toThrow("gossip policy changed with outstanding work");
    } finally {
      await old.close();
      await next.close();
    }
  });
  it("holds environment credits across restart and allows event bus reuse without misdirecting completion", async () => {
    const old = await fixture();
    const next = await fixture(old.events);
    try {
      old.drain(old.message());
      old.gossip.close();
      next.drain(next.message(2));
      expect(next.pending).toHaveLength(0);
      expect(next.runtime.reportGossip).not.toHaveBeenCalled();
      await old.retire(old.pending[0]);
      expect(old.runtime.reportGossip).not.toHaveBeenCalled();
      expect(next.runtime.reportGossip).not.toHaveBeenCalled();
      next.drain(next.message(3));
      expect(next.pending).toHaveLength(1);
    } finally {
      await old.close();
      await next.close();
    }
  });

  it("preserves a full handle through duplicate delivery and counts the complete backing buffer", async () => {
    const node = await fixture();
    try {
      const first = node.message();
      const duplicate = {...first, handle: {...first.handle, generation: first.handle.generation + 1n}};
      node.drain(first, duplicate, node.message(2));
      expect(node.pending).toHaveLength(1);
      expect(node.pending[0].msg.data).toBe(first.data);
      expect(node.pending[0].seenTimestampSec).toBe(12.345);
      expect(node.runtime.reportGossip.mock.calls).toEqual([
        [duplicate.handle, "ignore"],
        [node.message(2).handle, "ignore"],
      ]);
      await node.retire(node.pending[0]);
      await node.retire(node.pending[0]);
      expect(node.runtime.reportGossip).toHaveBeenLastCalledWith(first.handle, "accept");
      expect(node.runtime.reportGossip).toHaveBeenCalledTimes(3);
    } finally {
      await node.close();
    }
  });

  it("does not reserve host credit when a topic fails to parse", async () => {
    const node = await fixture();
    try {
      node.drain({...node.message(), topic: "/invalid"});
      await flush();
      expect(node.onError).toHaveBeenCalledWith(
        expect.objectContaining({message: expect.stringContaining("Invalid gossip topic /invalid")})
      );
      expect(node.runtime.reportGossip).toHaveBeenCalledWith(node.message().handle, "ignore");
      node.drain(node.message(2));
      expect(node.pending).toHaveLength(1);
    } finally {
      await node.close();
    }
  });

  it("waits for an executor before draining native handles", async () => {
    const node = await fixture(undefined, 1, false);
    try {
      node.drain(node.message());
      expect(node.pending).toHaveLength(0);
      expect(node.runtime.reportGossip).not.toHaveBeenCalled();
      node.gossip.attach(node.processor, node.wake);
      node.gossip.drain();
      expect(node.pending).toHaveLength(1);
    } finally {
      await node.close();
    }
  });

  it("retires an entire copied batch when preparation fails after acquiring credit", async () => {
    const node = await fixture(undefined, 3);
    const messages = [node.message(), {...node.message(2), topic: "/invalid"}, node.message(3)];
    try {
      node.drain(...messages);
      await flush();
      expect(node.processor.execute).not.toHaveBeenCalled();
      expect(node.onError).toHaveBeenCalledOnce();
      expect(node.runtime.reportGossip.mock.calls).toEqual(messages.map(({handle}) => [handle, "ignore"]));
      expect(node.gossip.snapshot()).toMatchObject({items: 0, bytes: 0, activeItems: 0});
      node.drain(node.message());
      expect(node.pending).toHaveLength(1);
    } finally {
      await node.close();
    }
  });

  it.each(["throw", "reject"])("retires all handles when the executor fails with %s", async (failure) => {
    const node = await fixture(undefined, 2);
    const error = new Error("executor failed");
    node.processor.execute.mockImplementationOnce(() => {
      if (failure === "throw") throw error;
      return Promise.reject(error);
    });
    try {
      node.drain(node.message(), node.message(2));
      await flush();
      expect(node.runtime.reportGossip.mock.calls).toEqual([
        [node.message().handle, "ignore"],
        [node.message(2).handle, "ignore"],
      ]);
      expect(node.gossip.snapshot()).toMatchObject({items: 0, bytes: 0, activeItems: 0});
      expect(node.onError).toHaveBeenCalledWith(error);
    } finally {
      await node.close();
    }
  });

  it("keeps work charged until the task settles even if a verdict event arrives early", async () => {
    const node = await fixture();
    try {
      node.drain(node.message());
      const message = node.pending[0];
      node.events.emit(NetworkEvent.gossipMessageValidationResult, {
        msgId: message.msgId,
        propagationSource: message.propagationSource,
        acceptance: TopicValidatorResult.Accept,
      });
      expect(node.gossip.snapshot()).toMatchObject({items: 1, bytes: 64});
      expect(node.runtime.reportGossip).not.toHaveBeenCalled();
      node.runtime.reportGossip.mockReturnValue(false);
      await node.retire(message);
      expect(node.gossip.snapshot()).toMatchObject({items: 0, bytes: 0});
      expect(node.runtime.reportGossip).toHaveBeenCalledOnce();
    } finally {
      await node.close();
    }
  });

  it("finishes accounting and preserves mixed verdicts before throwing metrics and event observers", async () => {
    const node = await fixture(undefined, 2);
    const observer = vi.fn(() => {
      expect(node.gossip.snapshot()).toMatchObject({items: 0, bytes: 0, activeItems: 0});
      expect(node.runtime.reportGossip).toHaveBeenCalledTimes(2);
      throw new Error("observer failed");
    });
    node.processor.observe.mockImplementation(observer);
    node.events.on(NetworkEvent.gossipMessageValidationResult, observer);
    try {
      node.drain(node.message(), node.message(2));
      await node.retire(node.pending[0]);
      expect(node.gossip.snapshot().items).toBe(2);
      await node.retire(node.pending[1], TopicValidatorResult.Reject);
      expect(node.runtime.reportGossip.mock.calls).toEqual([
        [node.message().handle, "accept"],
        [node.message(2).handle, "reject"],
      ]);
      expect(observer).toHaveBeenCalledTimes(3);
      expect(node.wake).toHaveBeenCalledOnce();
      expect(node.onError).toHaveBeenCalledWith(expect.any(AggregateError));
    } finally {
      await node.close();
    }
  });

  it("returns every credit and attempts every native completion when one report throws", async () => {
    const node = await fixture(undefined, 2);
    const error = new Error("native report failed");
    node.runtime.reportGossip.mockImplementationOnce(() => {
      throw error;
    });
    try {
      node.drain(node.message(), node.message(2));
      await node.retire(node.pending[0]);
      await node.retire(node.pending[1]);
      expect(node.runtime.reportGossip).toHaveBeenCalledTimes(2);
      expect(node.gossip.snapshot()).toMatchObject({items: 0, bytes: 0, activeItems: 0});
      expect(node.onError).toHaveBeenCalledWith(error);
      expect(node.wake).toHaveBeenCalledOnce();
    } finally {
      await node.close();
    }
  });

  it("wakes other runtimes after accounting completes even if an earlier wake throws", async () => {
    const old = await fixture();
    const next = await fixture();
    old.wake.mockImplementation(() => {
      throw new Error("wake failed");
    });
    try {
      old.drain(old.message());
      await old.retire(old.pending[0]);
      expect(old.runtime.reportGossip).toHaveBeenCalledOnce();
      expect(next.gossip.snapshot()).toMatchObject({items: 0, bytes: 0});
      expect(next.wake).toHaveBeenCalledOnce();
      expect(old.onError).toHaveBeenCalledWith(expect.any(AggregateError));
    } finally {
      await old.close();
      await next.close();
    }
  });

  it("returns the original byte credit even if validation transfers the backing buffer", async () => {
    const node = await fixture();
    try {
      const input = node.message();
      node.drain(input);
      structuredClone(input.data.buffer, {transfer: [input.data.buffer]});
      expect(input.data.byteLength).toBe(0);
      await node.retire(node.pending[0]);
      expect(node.gossip.snapshot()).toMatchObject({items: 0, bytes: 0});
      expect(node.onError).not.toHaveBeenCalled();
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
