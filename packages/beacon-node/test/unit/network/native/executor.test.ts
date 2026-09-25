import {generateKeyPair} from "@libp2p/crypto/keys";
import {TopicValidatorResult} from "@libp2p/gossipsub";
import {peerIdFromPublicKey} from "@libp2p/peer-id";
import {describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {defer, toRootHex} from "@lodestar/utils";
import {BlockInputSource} from "../../../../src/chain/blocks/blockInput/types.js";
import {ChainEvent} from "../../../../src/chain/emitter.js";
import {AttestationError, AttestationErrorCode, GossipAction} from "../../../../src/chain/errors/index.js";
import {Metrics} from "../../../../src/metrics/index.js";
import {INetworkCore} from "../../../../src/network/core/index.js";
import {NativeGossipExecutor} from "../../../../src/network/core/native/executor.js";
import {NetworkEvent, NetworkEventBus} from "../../../../src/network/events.js";
import {BatchGossipHandlerFn, GossipHandlers, GossipType} from "../../../../src/network/gossip/interface.js";
import {AggregatorTracker} from "../../../../src/network/processor/aggregatorTracker.js";
import {PendingGossipsubMessage} from "../../../../src/network/processor/types.js";
import {ClockEvent} from "../../../../src/util/clock.js";
import {ClockStopped} from "../../../mocks/clock.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";
import {getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {getMockedBeaconDb} from "../../../mocks/mockedBeaconDb.js";
import {createMetricsTest} from "../../metrics/utils.js";

function fixture(metrics: Metrics | null = null) {
  const single = vi.fn(async () => {});
  const batch = vi.fn<BatchGossipHandlerFn>(async (items) => items.map(() => null));
  const handlers: GossipHandlers = {
    beacon_block: single,
    blob_sidecar: single,
    data_column_sidecar: single,
    beacon_aggregate_and_proof: single,
    beacon_attestation: batch,
    voluntary_exit: single,
    proposer_slashing: single,
    attester_slashing: single,
    sync_committee_contribution_and_proof: single,
    sync_committee: single,
    light_client_finality_update: single,
    light_client_optimistic_update: single,
    bls_to_execution_change: single,
    execution_payload: single,
    payload_attestation_message: single,
    execution_payload_bid: single,
    proposer_preferences: single,
  };
  const base = getMockedBeaconChain();
  const chain = {
    ...base,
    clock: new ClockStopped(64),
    forkChoice: {...base.forkChoice, hasBlockHexUnsafe: vi.fn(() => false)},
    seenBlock: () => false,
    blsThreadPoolCanAcceptWork: vi.fn(() => true),
    regenCanAcceptWork: () => true,
  };
  const gossip = {attach: vi.fn(), notifyBlock: vi.fn(), dropQueued: vi.fn()};
  const events = new NetworkEventBus();
  const result = vi.fn();
  events.on(NetworkEvent.gossipMessageValidationResult, result);
  const wake = vi.fn();
  const executor = new NativeGossipExecutor(
    {
      chain,
      events,
      db: getMockedBeaconDb(),
      config: createBeaconConfig({}, new Uint8Array(32)),
      aggregatorTracker: new AggregatorTracker(),
      core: {} as INetworkCore,
      logger: getMockedLogger(),
      metrics,
      gossipHandlers: handlers,
    },
    {},
    gossip,
    wake
  );
  return {executor, chain, gossip, result, wake, single, batch};
}

function message(id: string, attestation = false): PendingGossipsubMessage {
  const boundary = {fork: ForkName.electra, epoch: 0};
  return {
    topic: attestation
      ? {type: GossipType.beacon_attestation, boundary, subnet: 0}
      : {type: GossipType.voluntary_exit, boundary},
    msg: {type: "unsigned", topic: "test", data: new Uint8Array(0)},
    msgId: id,
    propagationSource: "peer",
    clientAgent: "test",
    clientVersion: "test",
    seenTimestampSec: 0,
    startProcessUnixSec: null,
  };
}

describe("native gossip host execution", () => {
  it("returns running validation results through stop without using result events for completion", async () => {
    const f = fixture();
    const held = defer<void>();
    f.single.mockImplementation(() => held.promise);
    try {
      const execution = f.executor.execute([message("held")], false);
      const settled = vi.fn();
      void execution.then(settled);
      expect(f.single).toHaveBeenCalledOnce();
      f.executor.stop();
      f.executor.stop();
      expect(f.result).not.toHaveBeenCalled();
      expect(settled).not.toHaveBeenCalled();
      expect(f.gossip.dropQueued).toHaveBeenCalledOnce();
      expect(f.chain.clock.listenerCount(ClockEvent.slot)).toBe(0);
      held.resolve();
      await expect(execution).resolves.toEqual([TopicValidatorResult.Accept]);
      expect(f.result).not.toHaveBeenCalled();
      expect(settled).toHaveBeenCalledOnce();
      await expect(f.executor.execute([message("stopped")], false)).resolves.toEqual([TopicValidatorResult.Ignore]);
      expect(f.single).toHaveBeenCalledOnce();
    } finally {
      held.resolve();
      f.executor.stop();
    }
  });

  it("preserves mixed batch results and uses the batch handler for an unindexed single attestation", async () => {
    const f = fixture();
    try {
      f.batch.mockResolvedValueOnce([
        null,
        new AttestationError(GossipAction.REJECT, {code: AttestationErrorCode.INVALID_SIGNATURE}),
      ]);
      expect(await f.executor.execute([message("accept", true), message("reject", true)], true)).toEqual([
        TopicValidatorResult.Accept,
        TopicValidatorResult.Reject,
      ]);
      await expect(f.executor.execute([message("unindexed", true)], false)).resolves.toEqual([
        TopicValidatorResult.Accept,
      ]);
      expect(f.batch).toHaveBeenCalledTimes(2);
      expect(f.single).not.toHaveBeenCalled();
    } finally {
      f.executor.stop();
    }
  });

  it("records submission while validation is running and returns the verdict before completion metrics", async () => {
    const metrics = createMetricsTest();
    const submitted = vi.spyOn(metrics.networkProcessor.jobsSubmitted, "observe");
    const observed = vi.spyOn(metrics.gossipValidationQueue.jobTime, "observe").mockImplementation(() => {
      throw new Error("completion metric failed");
    });
    const f = fixture(metrics);
    const held = defer<void>();
    f.single.mockImplementation(() => held.promise);
    try {
      const messages = [message("held")];
      const execution = f.executor.execute(messages, false);
      expect(submitted).toHaveBeenCalledWith(1);
      expect(observed).not.toHaveBeenCalled();
      held.resolve();
      const results = await execution;
      expect(results).toEqual([TopicValidatorResult.Accept]);
      expect(() => f.executor.observe(messages, results)).toThrow("completion metric failed");
      expect(results).toEqual([TopicValidatorResult.Accept]);
    } finally {
      held.resolve();
      f.executor.stop();
      submitted.mockRestore();
      observed.mockRestore();
    }
  });

  it("queries authoritative chain state, searches an unknown root once per peer, and forwards imports", async () => {
    const f = fixture();
    const key = await generateKeyPair("secp256k1");
    const root = new Uint8Array(32).fill(7);
    const check = {
      handle: {generation: 1n, index: 0},
      root,
      slot: 64n,
      peerId: peerIdFromPublicKey(key.publicKey).toString(),
      topic: "test",
    };
    const search = vi.fn();
    f.chain.emitter.on(ChainEvent.unknownBlockRoot, search);
    try {
      expect(f.executor.check([check])).toEqual([false]);
      expect(search).toHaveBeenCalledWith(
        expect.objectContaining({rootHex: toRootHex(root), source: BlockInputSource.network_processor})
      );
      // The same root from the same peer searches once while its search lasts, and once more after it expires.
      expect(f.executor.check([check])).toEqual([false]);
      expect(search).toHaveBeenCalledOnce();
      const now = performance.now();
      const clock = vi.spyOn(performance, "now").mockReturnValue(now + 30_000);
      expect(f.executor.check([check])).toEqual([false]);
      expect(search).toHaveBeenCalledTimes(2);
      clock.mockRestore();
      f.chain.forkChoice.hasBlockHexUnsafe.mockReturnValue(true);
      expect(f.executor.check([check])).toEqual([true]);
      f.chain.emitter.emit(routes.events.EventType.block, {
        block: toRootHex(root),
        slot: 64,
        executionOptimistic: false,
      });
      expect(f.gossip.notifyBlock).toHaveBeenCalledWith(Buffer.from(root));
    } finally {
      f.executor.stop();
    }
  });
  it("coalesces root lookups within a batch while forwarding every source hint", async () => {
    const f = fixture();
    const search = vi.fn();
    f.chain.emitter.on(ChainEvent.unknownBlockRoot, search);
    const checks = [0, 1, 2].map((index) => ({
      handle: {index, generation: 1n},
      root: new Uint8Array(32),
      slot: 64n,
      peerId: `peer-${index}`,
      topic: "test",
    }));
    try {
      expect(f.executor.check(checks)).toEqual([false, false, false]);
      expect(f.chain.forkChoice.hasBlockHexUnsafe).toHaveBeenCalledOnce();
      expect(search.mock.calls.map(([event]) => event.peer)).toEqual(["peer-0", "peer-1", "peer-2"]);
      f.chain.forkChoice.hasBlockHexUnsafe.mockReturnValue(true);
      expect(f.executor.check(checks)).toEqual([true, true, true]);
      expect(f.chain.forkChoice.hasBlockHexUnsafe).toHaveBeenCalledTimes(2);
      expect(search).toHaveBeenCalledTimes(3);
    } finally {
      f.executor.stop();
    }
  });

  it("rejects a non-attestation job containing more than one message", async () => {
    const f = fixture();
    try {
      await expect(f.executor.execute([message("first"), message("second")], false)).rejects.toThrow(
        "native gossip validator job"
      );
      expect(f.single).not.toHaveBeenCalled();
    } finally {
      f.executor.stop();
    }
  });
});

describe("native gossip executor searches", () => {
  it("bounds unknown-root searches to eight peers and one anonymous request per root, and 96 roots", async () => {
    const f = fixture();
    const search = vi.fn();
    f.chain.emitter.on(ChainEvent.unknownBlockRoot, search);
    const check = (root: number, peerId: string) => ({
      handle: {index: 0, generation: 1n},
      root: new Uint8Array(32).fill(root),
      slot: 64n,
      peerId,
      topic: "test",
    });
    try {
      for (let i = 0; i < 10; i++) f.executor.check([check(1, `peer-${i}`)]);
      expect(search).toHaveBeenCalledTimes(8);
      f.executor.searchUnknownBlock({slot: 64, root: toRootHex(new Uint8Array(32).fill(1))}, BlockInputSource.gossip);
      f.executor.searchUnknownBlock({slot: 64, root: toRootHex(new Uint8Array(32).fill(1))}, BlockInputSource.gossip);
      expect(search).toHaveBeenCalledTimes(9);
      for (let root = 2; root < 98; root++) f.executor.check([check(root, "peer")]);
      expect(search).toHaveBeenCalledTimes(9 + 95);
    } finally {
      f.executor.stop();
    }
  });
});
