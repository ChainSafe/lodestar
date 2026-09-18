import {generateKeyPair} from "@libp2p/crypto/keys";
import {TopicValidatorResult} from "@libp2p/gossipsub";
import {describe, expect, it, vi} from "vitest";
import {NativeGossipMessage, NativeNetworkApplicationRuntime} from "@chainsafe/lodestar-z/network";
import {createBeaconConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
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

async function fixture(events = new NetworkEventBus(), hostGossipItems = 1) {
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
  const gossip = new NativeGossip(runtime, config, events, opts);
  const pending: PendingGossipsubMessage[] = [];
  const receive = (message: PendingGossipsubMessage): void => {
    pending.push(message);
  };
  events.on(NetworkEvent.pendingGossipsubMessage, receive);
  const retire = (message: PendingGossipsubMessage): void =>
    events.emit(NetworkEvent.gossipMessageValidationResult, {
      msgId: message.msgId,
      propagationSource: message.propagationSource,
      acceptance: TopicValidatorResult.Accept,
    });
  return {
    gossip,
    events,
    runtime,
    opts,
    pending,
    retire,
    message(id = 1): NativeGossipMessage {
      return {
        handle: {session: (1n << 62n) + 7n, index: 0, generation: (1n << 63n) + BigInt(id)},
        connection: {index: 0, generation: 1},
        peerId: peer.publicKey.toMultihash().bytes,
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
    close(): void {
      gossip.close();
      for (const message of pending) retire(message);
      events.off(NetworkEvent.pendingGossipsubMessage, receive);
    },
  };
}

describe("native gossip host ownership", () => {
  it("wakes the replacement runtime when an older runtime returns execution credit", async () => {
    const old = await fixture();
    const next = await fixture();
    const wake = vi.fn();
    try {
      old.drain(old.message());
      old.gossip.close();
      next.gossip.attach({check: () => true, canExecute: () => true, execute: vi.fn()}, wake);
      expect(next.gossip.snapshot().items).toBe(1);
      old.retire(old.pending[0]);
      expect(wake).toHaveBeenCalledOnce();
      expect(next.gossip.snapshot().items).toBe(0);
    } finally {
      old.close();
      next.close();
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
          new NativeGossip(next.runtime, config, new NetworkEventBus(), {
            ...next.opts,
            native: {hostGossipItems: 3, hostGossipBytes: 192},
          })
      ).toThrow("gossip policy changed with outstanding work");
    } finally {
      old.close();
      next.close();
    }
  });
  it("holds environment credits and the old bus until host retirement after native close", async () => {
    const old = await fixture();
    const next = await fixture();
    try {
      old.drain(old.message());
      old.gossip.close();
      expect(() => new NativeGossip(old.runtime, config, old.events, old.opts)).toThrow("gossip event bus still owned");
      next.drain(next.message(2));
      expect(next.pending).toHaveLength(0);
      expect(next.runtime.reportGossip).not.toHaveBeenCalled();
      old.retire(old.pending[0]);
      expect(old.runtime.reportGossip).not.toHaveBeenCalled();
      const reopened = new NativeGossip(old.runtime, config, old.events, old.opts);
      reopened.close();
      next.drain(next.message(3));
      expect(next.pending).toHaveLength(1);
    } finally {
      old.close();
      next.close();
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
      node.retire(node.pending[0]);
      node.retire(node.pending[0]);
      expect(node.runtime.reportGossip).toHaveBeenLastCalledWith(first.handle, "accept");
      expect(node.runtime.reportGossip).toHaveBeenCalledTimes(3);
    } finally {
      node.close();
    }
  });

  it("does not reserve host credit when a topic fails to parse", async () => {
    const node = await fixture();
    try {
      expect(() => node.drain({...node.message(), topic: "/invalid"})).toThrow("Invalid gossip topic");
      node.drain(node.message(2));
      expect(node.pending).toHaveLength(1);
    } finally {
      node.close();
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
      node.close();
    }
  });
});
