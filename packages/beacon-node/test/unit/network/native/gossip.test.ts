import {generateKeyPair} from "@libp2p/crypto/keys";
import {TopicValidatorResult} from "@libp2p/gossipsub";
import {peerIdFromPublicKey} from "@libp2p/peer-id";
import {afterEach, describe, expect, it, vi} from "vitest";
import {GossipJob, GossipMessage, NativeNetwork} from "@chainsafe/lodestar-z/network";
import {createBeaconConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {defer} from "@lodestar/utils";
import {NativeGossipExecutor} from "../../../../src/network/core/native/executor.js";
import {NativeGossip} from "../../../../src/network/core/native/gossip.js";
import {NativePeerReports} from "../../../../src/network/core/native/reports.js";
import {GossipType} from "../../../../src/network/gossip/interface.js";
import {stringifyGossipTopic} from "../../../../src/network/gossip/topic.js";
import {defaultNetworkOptions} from "../../../../src/network/options.js";
import {PendingGossipsubMessage} from "../../../../src/network/processor/types.js";
import {isPublishDuplicateError} from "../../../../src/network/util.js";

afterEach(() => vi.restoreAllMocks());

const config = createBeaconConfig({ALTAIR_FORK_EPOCH: Infinity}, new Uint8Array(32));
const topic = stringifyGossipTopic(config, {
  type: GossipType.voluntary_exit,
  boundary: {fork: ForkName.phase0, epoch: 0},
});

async function fixture(attach = true) {
  const peer = await generateKeyPair("secp256k1");
  const network = {
    limits: {peerCapacity: 64, incomingCapacity: 32, publicationMaxWaitMs: 12000},
    waitForPublicationCapacity: vi.fn<NativeNetwork["waitForPublicationCapacity"]>(),
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
  const onError = vi.fn();
  const gossip = new NativeGossip(network, config, defaultNetworkOptions, onError, new NativePeerReports(network));
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
  return {kind: "voluntary_exit", grouped, messages};
}

describe("native gossip host", () => {
  it("validates a job's messages as pending gossipsub messages and returns their verdicts in order", async () => {
    const node = await fixture();
    const validating = job([node.message(1), node.message(2), node.message(3)], true);
    const validated = node.gossip.validate(validating);
    expect(node.processor.execute).toHaveBeenCalledExactlyOnceWith(node.pending, true);
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
    expect(node.processor.observe).toHaveBeenCalledOnce();
  });

  it("reports the executor's readiness as ordinary capacity and answers dependency checks in one call", async () => {
    const node = await fixture();
    const checks = [1, 2].map((id) => ({
      root: new Uint8Array(32),
      slot: 1n,
      peerId: node.message(id).peerId,
      topic,
      kind: "voluntary_exit" as const,
      payloadPresent: false,
      parentBlockHash: null,
    }));
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

  it("returns every verdict when observation throws, and reports the failure once", async () => {
    const node = await fixture();
    const error = new Error("observer failed");
    const observer = vi.fn(() => {
      throw error;
    });
    node.processor.observe.mockImplementation(observer);
    const validated = node.gossip.validate(job([node.message(1), node.message(2)], true));
    node.retire(node.pending[0]);
    node.retire(node.pending[1], TopicValidatorResult.Reject);
    expect(await validated).toEqual(["accept", "reject"]);
    expect(observer).toHaveBeenCalledOnce();
    expect(node.onError).toHaveBeenCalledExactlyOnceWith(error);
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
      maxQueueMs: expect.any(Number),
    });
    node.network.publish.mockRejectedValueOnce(
      Object.assign(new Error("duplicate"), {code: "NetworkGossipPublishFailed", reason: "duplicate"})
    );
    const error = await node.gossip.publish(topic, data).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(isPublishDuplicateError(error as Error)).toBe(true);
  });

  it.each(["admission_full", "expired"])("preserves the binding's %s failure without resubmitting", async (reason) => {
    const node = await fixture();
    const failure = Object.assign(new Error(reason), {code: "NetworkGossipPublishFailed", reason});
    node.network.publish.mockRejectedValueOnce(failure);
    await expect(node.gossip.publish(topic, new Uint8Array(112))).rejects.toBe(failure);
    expect(node.network.publish).toHaveBeenCalledTimes(1);
  });

  it("waits for admission and carries the original deadline into the queue", async () => {
    const node = await fixture();
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const released = defer<void>();
    node.network.publish.mockRejectedValueOnce(
      Object.assign(new Error("full"), {
        code: "NetworkGossipPublishFailed",
        reason: "admission_full",
        capacityToken: "slots",
      })
    );
    node.network.waitForPublicationCapacity.mockReturnValueOnce(released.promise);
    const data = new Uint8Array(112);
    const published = node.gossip.publish(topic, data);
    await Promise.resolve();
    expect(node.network.publish).toHaveBeenCalledOnce();
    expect(node.network.waitForPublicationCapacity).toHaveBeenCalledWith("slots", {
      signal: expect.any(AbortSignal),
      timeoutMs: 12000,
    });
    now += 5000;
    released.resolve();
    expect(await published).toBe(1);
    expect(node.network.publish).toHaveBeenLastCalledWith(topic, data, expect.objectContaining({maxQueueMs: 7000}));
    expect(node.network.publish).toHaveBeenCalledTimes(2);
    node.gossip.close();
  });

  it("does not resubmit when capacity arrives after the original deadline", async () => {
    const node = await fixture();
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    node.network.publish.mockRejectedValueOnce(
      Object.assign(new Error("full"), {
        code: "NetworkGossipPublishFailed",
        reason: "admission_full",
        capacityToken: "slots",
      })
    );
    node.network.waitForPublicationCapacity.mockImplementationOnce(async () => {
      now += 12000;
    });
    await expect(node.gossip.publish(topic, new Uint8Array(112))).rejects.toMatchObject({reason: "expired"});
    expect(node.network.publish).toHaveBeenCalledOnce();
    node.gossip.close();
  });

  it("cancels capacity waits on close without cancelling an admitted publication", async () => {
    const node = await fixture();
    const admitted = defer<Awaited<ReturnType<NativeNetwork["publish"]>>>();
    node.network.publish.mockReturnValueOnce(admitted.promise).mockRejectedValueOnce(
      Object.assign(new Error("full"), {
        code: "NetworkGossipPublishFailed",
        reason: "admission_full",
        capacityToken: "slots",
      })
    );
    node.network.waitForPublicationCapacity.mockImplementationOnce(
      (_token, {signal}) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("cancelled")), {once: true});
        })
    );
    const publishing = node.gossip.publish(topic, new Uint8Array(112));
    const waiting = node.gossip.publish(topic, new Uint8Array(112));
    const cancelled = expect(waiting).rejects.toThrow("cancelled");
    await Promise.resolve();
    node.gossip.close();
    await cancelled;
    admitted.resolve({queued: 1, selected: 1, pressured: 0, unavailable: 0, duplicate: false});
    expect(await publishing).toBe(1);
    expect(node.network.publish).toHaveBeenCalledTimes(2);
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
