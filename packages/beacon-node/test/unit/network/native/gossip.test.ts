import {generateKeyPair} from "@libp2p/crypto/keys";
import {TopicValidatorResult} from "@libp2p/gossipsub";
import {peerIdFromPublicKey} from "@libp2p/peer-id";
import {describe, expect, it, vi} from "vitest";
import {GossipJob, GossipMessage, NativeNetwork} from "@chainsafe/lodestar-z/network";
import {createBeaconConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {defer} from "@lodestar/utils";
import {NativeGossipExecutor} from "../../../../src/network/core/native/executor.js";
import {NativeGossip} from "../../../../src/network/core/native/gossip.js";
import {NativePeerReports} from "../../../../src/network/core/native/reports.js";
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

async function fixture(attach = true) {
  const peer = await generateKeyPair("secp256k1");
  const network = {
    publish: vi.fn<NativeNetwork["publish"]>(async () => ({
      queued: 1,
      selected: 1,
      unavailable: 0,
      pressured: 0,
      duplicate: false,
    })),
    reportPeer: vi.fn<NativeNetwork["reportPeer"]>(),
    blockImported: vi.fn<NativeNetwork["blockImported"]>(),
    dropQueuedGossip: vi.fn<NativeNetwork["dropQueuedGossip"]>(),
  };
  const events = new NetworkEventBus();
  const onError = vi.fn();
  const gossip = new NativeGossip(
    network,
    config,
    events,
    defaultNetworkOptions,
    onError,
    new NativePeerReports(network)
  );
  const pending: PendingGossipsubMessage[] = [];
  const completions = new Map<PendingGossipsubMessage, ReturnType<typeof defer<TopicValidatorResult>>>();
  const processor = {
    subscribeCapacity: vi.fn((_wake: () => void) => vi.fn()),
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
  return {
    gossip,
    network,
    events,
    processor,
    pending,
    onError,
    retire(message: PendingGossipsubMessage, result = TopicValidatorResult.Accept): void {
      completions.get(message)?.resolve(result);
    },
    message(id = 1, messageTopic = topic): GossipMessage {
      return {
        connection: {index: 0, generation: 1},
        endpoint: null,
        peerId: peerIdFromPublicKey(peer.publicKey).toString(),
        topic: messageTopic,
        id: new Uint8Array(20).fill(id),
        data: new Uint8Array(new ArrayBuffer(64), 0, 1),
        receivedAtUnixMs: 12345,
        slot: 7n,
        attestationData: null,
      };
    },
  };
}

function job(messages: GossipMessage[], grouped = false): GossipJob {
  return {kind: "voluntary_exit", grouped, messages, reported: new Promise(() => {})};
}

describe("native gossip host", () => {
  it("validates a job's messages as pending gossipsub messages and returns their verdicts in order", async () => {
    const node = await fixture();
    const results = vi.fn();
    node.events.on(NetworkEvent.gossipMessageValidationResult, results);
    const validating = job([node.message(1), node.message(2), node.message(3)], true);
    const validated = node.gossip.validate(validating);
    expect(node.processor.execute).toHaveBeenCalledExactlyOnceWith(node.pending, true, validating.reported);
    expect(node.pending[0]).toMatchObject({
      msgId: Buffer.from(node.message(1).id).toString("hex"),
      msgSlot: 7,
      seenTimestampSec: 12.345,
      topic: {type: GossipType.voluntary_exit},
    });
    node.retire(node.pending[0]);
    node.retire(node.pending[1], TopicValidatorResult.Reject);
    node.retire(node.pending[2], TopicValidatorResult.Ignore);
    expect(await validated).toEqual(["accept", "reject", "ignore"]);
    expect(results.mock.calls.map(([result]) => result.acceptance)).toEqual([
      TopicValidatorResult.Accept,
      TopicValidatorResult.Reject,
      TopicValidatorResult.Ignore,
    ]);
    expect(node.processor.observe).toHaveBeenCalledOnce();
  });

  it("reports the executor's readiness as ordinary capacity and answers dependency checks in one call", async () => {
    const node = await fixture();
    const checks = [1, 2].map((id) => ({root: new Uint8Array(32), slot: 1n, peerId: node.message(id).peerId, topic}));
    expect(node.gossip.ready()).toBe(true);
    node.processor.ready.mockReturnValue(false);
    expect(node.gossip.ready()).toBe(false);
    node.processor.check.mockReturnValueOnce([true, false]);
    expect(node.gossip.checkDependencies(checks)).toEqual([true, false]);
    expect(node.processor.check).toHaveBeenCalledExactlyOnceWith(checks);
  });

  it("takes no work before an executor attaches, and only one executor", async () => {
    const node = await fixture(false);
    expect(node.gossip.ready()).toBe(false);
    await expect(node.gossip.validate(job([node.message()]))).rejects.toThrow("gossip executor");
    expect(() => node.gossip.checkDependencies([])).toThrow("gossip executor");
    node.gossip.attach(node.processor);
    expect(() => node.gossip.attach(node.processor)).toThrow("gossip executor attachment");
  });

  it("rejects a job whose topic cannot be prepared, before executing any of it", async () => {
    const node = await fixture();
    await expect(node.gossip.validate(job([node.message(1), node.message(2, "/invalid")], true))).rejects.toThrow();
    expect(node.processor.execute).not.toHaveBeenCalled();
  });

  it.each(["throw", "reject"])("rejects a job whose executor fails with %s, without observing it", async (failure) => {
    const node = await fixture();
    const error = new Error("executor failed");
    node.processor.execute.mockImplementationOnce(() => {
      if (failure === "throw") throw error;
      return Promise.reject(error);
    });
    await expect(node.gossip.validate(job([node.message(1), node.message(2)], true))).rejects.toBe(error);
    expect(node.processor.observe).not.toHaveBeenCalled();
    expect(node.onError).not.toHaveBeenCalled();
  });

  it("returns every verdict when observers and result events throw, and reports their failures once", async () => {
    const node = await fixture();
    const observer = vi.fn(() => {
      throw new Error("observer failed");
    });
    node.processor.observe.mockImplementation(observer);
    node.events.on(NetworkEvent.gossipMessageValidationResult, observer);
    const validated = node.gossip.validate(job([node.message(1), node.message(2)], true));
    node.retire(node.pending[0]);
    node.retire(node.pending[1], TopicValidatorResult.Reject);
    expect(await validated).toEqual(["accept", "reject"]);
    expect(observer).toHaveBeenCalledTimes(3);
    expect(node.onError).toHaveBeenCalledExactlyOnceWith(expect.any(AggregateError));
  });

  it("forwards imported blocks and drops until it closes", async () => {
    const node = await fixture();
    const root = new Uint8Array(32).fill(1);
    node.gossip.notifyBlock(root);
    node.gossip.dropQueued();
    node.gossip.close();
    node.gossip.notifyBlock(root);
    node.gossip.dropQueued();
    expect(node.network.blockImported).toHaveBeenCalledExactlyOnceWith(root);
    expect(node.network.dropQueuedGossip).toHaveBeenCalledOnce();
  });

  it("preserves publication options and the existing duplicate error contract", async () => {
    const node = await fixture();
    const data = new Uint8Array(112);
    expect(
      await node.gossip.publish(topic, data, {
        floodPublish: true,
        allowPublishToZeroTopicPeers: true,
        ignoreDuplicatePublishError: true,
      })
    ).toBe(1);
    expect(node.network.publish).toHaveBeenCalledWith(topic, data, {
      flood: true,
      allowZeroPeers: true,
      ignoreDuplicate: true,
    });
    node.network.publish.mockRejectedValueOnce(
      Object.assign(new Error("duplicate"), {code: "NetworkGossipPublishFailed", reason: "duplicate"})
    );
    const error = await node.gossip.publish(topic, data).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(isPublishDuplicateError(error as Error)).toBe(true);
  });

  it("retries admission pressure after yielding, with the same bytes and options", async () => {
    const node = await fixture();
    const pressure = Object.assign(new Error("full"), {code: "NetworkGossipPublishFailed", reason: "admission_full"});
    node.network.publish.mockRejectedValueOnce(pressure).mockRejectedValueOnce(pressure);
    const data = new Uint8Array(112);
    const published = node.gossip.publish(topic, data, {floodPublish: true});
    await Promise.resolve();
    expect(node.network.publish).toHaveBeenCalledTimes(1);
    expect(await published).toBe(1);
    expect(node.network.publish).toHaveBeenCalledTimes(3);
    for (const call of node.network.publish.mock.calls) {
      expect(call[1]).toBe(data);
      expect(call[2]).toEqual(node.network.publish.mock.calls[0][2]);
    }
  });

  it("does not retry protocol resource exhaustion or a completed publication under peer pressure", async () => {
    const node = await fixture();
    const failure = Object.assign(new Error("full"), {
      code: "NetworkGossipPublishFailed",
      reason: "resource_exhausted",
    });
    node.network.publish.mockRejectedValueOnce(failure);
    await expect(node.gossip.publish(topic, new Uint8Array(112))).rejects.toBe(failure);
    expect(node.network.publish).toHaveBeenCalledTimes(1);
    node.network.publish.mockResolvedValueOnce({
      queued: 1,
      selected: 3,
      pressured: 2,
      unavailable: 0,
      duplicate: false,
    });
    expect(await node.gossip.publish(topic, new Uint8Array(112))).toBe(1);
    expect(node.network.publish).toHaveBeenCalledTimes(2);
  });

  it("terminates a waiting publication on close", async () => {
    const node = await fixture();
    node.network.publish.mockRejectedValue(
      Object.assign(new Error("full"), {
        code: "NetworkGossipPublishFailed",
        reason: "admission_full",
      })
    );
    const published = node.gossip.publish(topic, new Uint8Array(112));
    await Promise.resolve();
    node.gossip.close();
    await expect(published).rejects.toMatchObject({type: {code: "NATIVE_NETWORK_CLOSED"}});
    expect(node.network.publish).toHaveBeenCalledTimes(1);
  });

  it("fails explicitly if admission remains blocked for a slot", async () => {
    const node = await fixture();
    const now = vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(config.SLOT_DURATION_MS);
    try {
      const pressure = Object.assign(new Error("full"), {code: "NetworkGossipPublishFailed", reason: "admission_full"});
      node.network.publish.mockRejectedValue(pressure);
      await expect(node.gossip.publish(topic, new Uint8Array(112))).rejects.toBe(pressure);
      expect(node.network.publish).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
    }
  });
});

it("wakes an existing capacity subscription when its executor attaches and detaches it once", async () => {
  const f = await fixture(false);
  const wake = vi.fn();
  const unsubscribe = f.gossip.subscribeCapacity(wake);
  expect(f.gossip.ready()).toBe(false);
  f.gossip.attach(f.processor);
  expect(f.processor.subscribeCapacity).toHaveBeenCalledExactlyOnceWith(wake);
  expect(wake).toHaveBeenCalledOnce();
  expect(f.gossip.ready()).toBe(true);
  const detach = f.processor.subscribeCapacity.mock.results[0].value;
  unsubscribe();
  unsubscribe();
  expect(detach).toHaveBeenCalledOnce();
});
