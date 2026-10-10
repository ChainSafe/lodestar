import {generateKeyPair} from "@libp2p/crypto/keys";
import {TopicValidatorResult} from "@libp2p/gossipsub";
import {peerIdFromPublicKey} from "@libp2p/peer-id";
import {describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {ProtoBlock} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {defer, toRootHex} from "@lodestar/utils";
import {BlockInputPreData} from "../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../../src/chain/blocks/blockInput/types.js";
import {ChainEvent} from "../../../../src/chain/emitter.js";
import {AttestationError, AttestationErrorCode, GossipAction} from "../../../../src/chain/errors/index.js";
import {SeenBlockProposers} from "../../../../src/chain/seenCache/seenBlockProposers.js";
import {ZERO_HASH, ZERO_HASH_HEX} from "../../../../src/constants/index.js";
import {Metrics} from "../../../../src/metrics/index.js";
import {INetworkCore} from "../../../../src/network/core/index.js";
import {NativeGossipExecutor} from "../../../../src/network/core/native/executor.js";
import {NetworkEvent, NetworkEventBus} from "../../../../src/network/events.js";
import {BatchGossipHandlerFn, GossipHandlers, GossipType} from "../../../../src/network/gossip/interface.js";
import {INetwork} from "../../../../src/network/interface.js";
import {AggregatorTracker} from "../../../../src/network/processor/aggregatorTracker.js";
import {PendingGossipsubMessage} from "../../../../src/network/processor/types.js";
import {defaultSyncOptions} from "../../../../src/sync/options.js";
import {BlockInputSync} from "../../../../src/sync/unknownBlock.js";
import {ClockEvent} from "../../../../src/util/clock.js";
import {ClockStopped} from "../../../mocks/clock.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";
import {getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {getMockedBeaconDb} from "../../../mocks/mockedBeaconDb.js";
import {getRandPeerIdStr} from "../../../utils/peer.js";
import {createMetricsTest} from "../../metrics/utils.js";

/** An executor over a mocked chain; `stubbed` replaces the gossip handlers with stubs. */
function fixture(metrics: Metrics | null = null, stubbed = true) {
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
  const config = createBeaconConfig({}, new Uint8Array(32));
  const base = getMockedBeaconChain({config});
  const chain = {
    ...base,
    clock: new ClockStopped(64),
    forkChoice: {...base.forkChoice, hasBlockHexUnsafe: vi.fn(() => false)},
    seenBlock: () => false,
    seenBlockProposers: new SeenBlockProposers(),
    blsThreadPoolCanAcceptWork: vi.fn(() => true),
    regenCanAcceptWork: () => true,
  };
  const gossip = {attach: vi.fn(), notifyBlock: vi.fn(), dropQueued: vi.fn()};
  const events = new NetworkEventBus();
  const result = vi.fn();
  events.on(NetworkEvent.gossipMessageValidationResult, result);
  const wake = vi.fn();
  const logger = getMockedLogger();
  const executor = new NativeGossipExecutor(
    {
      chain,
      events,
      db: getMockedBeaconDb(),
      config,
      aggregatorTracker: new AggregatorTracker(),
      core: {reportPeer: vi.fn()} as unknown as INetworkCore,
      logger,
      metrics,
      gossipHandlers: stubbed ? handlers : undefined,
    },
    {},
    gossip
  );
  const unsubscribe = executor.subscribeCapacity(wake);
  return {unsubscribe, executor, chain, gossip, result, wake, single, batch, config, logger};
}

/** The owner's disposition of a job's verdicts, which these tests never withhold. */
const reported = Promise.resolve();

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
      const execution = f.executor.execute([message("held")], false, reported);
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
      await expect(f.executor.execute([message("stopped")], false, reported)).resolves.toEqual([
        TopicValidatorResult.Ignore,
      ]);
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
      expect(await f.executor.execute([message("accept", true), message("reject", true)], true, reported)).toEqual([
        TopicValidatorResult.Accept,
        TopicValidatorResult.Reject,
      ]);
      await expect(f.executor.execute([message("unindexed", true)], false, reported)).resolves.toEqual([
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
      const execution = f.executor.execute(messages, false, reported);
      expect(submitted).toHaveBeenCalledWith(1);
      expect(observed).not.toHaveBeenCalled();
      held.resolve();
      const results = await execution;
      expect(results).toEqual([TopicValidatorResult.Accept]);
      expect(() => f.executor.observe(messages)).toThrow("completion metric failed");
      expect(results).toEqual([TopicValidatorResult.Accept]);
    } finally {
      held.resolve();
      f.executor.stop();
      submitted.mockRestore();
      observed.mockRestore();
    }
  });

  it("records completed work for accepted, rejected and ignored messages in a mixed batch", async () => {
    const metrics = createMetricsTest();
    const observed = vi.spyOn(metrics.gossipValidationQueue.jobTime, "observe");
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    const f = fixture(metrics);
    try {
      f.batch.mockResolvedValueOnce([
        null,
        new AttestationError(GossipAction.REJECT, {code: AttestationErrorCode.INVALID_SIGNATURE}),
        new AttestationError(GossipAction.IGNORE, {code: AttestationErrorCode.INVALID_SIGNATURE}),
      ]);
      const messages = [message("accept", true), message("reject", true), message("ignore", true)];
      const results = await f.executor.execute(messages, true, reported);
      expect(results).toEqual([TopicValidatorResult.Accept, TopicValidatorResult.Reject, TopicValidatorResult.Ignore]);
      expect(observed).not.toHaveBeenCalled();
      now.mockReturnValue(1300);
      f.executor.observe(messages);
      expect(observed).toHaveBeenCalledTimes(3);
      for (const [labels, duration] of observed.mock.calls) {
        expect(labels).toEqual({topic: GossipType.beacon_attestation});
        expect(duration).toBeCloseTo(0.1);
      }
      f.executor.observe([message("never started")]);
      expect(observed).toHaveBeenCalledTimes(3);
    } finally {
      f.executor.stop();
      now.mockRestore();
      observed.mockRestore();
    }
  });

  it("queries authoritative chain state and forwards imports", async () => {
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
    const envelopeSearch = vi.fn();
    f.chain.emitter.on(ChainEvent.unknownBlockRoot, search);
    f.chain.emitter.on(ChainEvent.unknownEnvelopeBlockRoot, envelopeSearch);
    try {
      expect(f.executor.check([check])).toEqual([false]);
      expect(search).toHaveBeenCalledWith(
        expect.objectContaining({rootHex: toRootHex(root), source: BlockInputSource.network_processor})
      );
      f.executor.searchUnknownEnvelope({slot: 64, root: toRootHex(root)}, BlockInputSource.gossip, check.peerId);
      expect(envelopeSearch).toHaveBeenCalledExactlyOnceWith({
        rootHex: toRootHex(root),
        source: BlockInputSource.gossip,
        peer: check.peerId,
      });
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
    const peers = Array.from({length: 10}, (_, index) => `peer-${index}`);
    const checks = peers.map((peerId, index) => ({
      handle: {index, generation: 1n},
      root: new Uint8Array(32),
      slot: 64n,
      peerId,
      topic: "test",
    }));
    try {
      expect(f.executor.check([...checks, ...checks])).toEqual(Array(20).fill(false));
      expect(f.chain.forkChoice.hasBlockHexUnsafe).toHaveBeenCalledOnce();
      expect(search.mock.calls.map(([event]) => event.peer)).toEqual(peers);
      f.chain.forkChoice.hasBlockHexUnsafe.mockReturnValue(true);
      expect(f.executor.check(checks)).toEqual(Array(10).fill(true));
      expect(f.chain.forkChoice.hasBlockHexUnsafe).toHaveBeenCalledTimes(2);
      expect(search).toHaveBeenCalledTimes(10);
    } finally {
      f.executor.stop();
    }
  });

  it("validates a block with its handler alone, which searches an unknown parent once or rejects the block", async () => {
    const f = fixture(null, false);
    const signedBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
    signedBlock.message.slot = 2;
    signedBlock.message.parentRoot.fill(9);
    const blockRootHex = toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(signedBlock.message));
    const block: PendingGossipsubMessage = {
      ...message("block"),
      topic: {type: GossipType.beacon_block, boundary: {fork: ForkName.phase0, epoch: 0}},
      msg: {type: "unsigned", topic: "test", data: ssz.phase0.SignedBeaconBlock.serialize(signedBlock)},
    };
    const blockInput = BlockInputPreData.createFromBlock({
      block: signedBlock,
      blockRootHex,
      forkName: ForkName.phase0,
      daOutOfRange: false,
      source: BlockInputSource.gossip,
      seenTimestampSec: 0,
      peerIdStr: "peer",
    });
    vi.mocked(f.chain.seenBlockInputCache.getByBlock).mockReturnValue(blockInput);
    f.chain.forkChoice.getFinalizedCheckpoint.mockReturnValue({epoch: 0, root: ZERO_HASH, rootHex: ZERO_HASH_HEX});
    f.chain.forkChoice.getBlockHexDefaultStatus.mockReturnValue(null);
    const recovery = vi.fn();
    const search = vi.fn();
    f.chain.emitter.on(ChainEvent.blockUnknownParent, recovery);
    f.chain.emitter.on(ChainEvent.unknownBlockRoot, search);
    try {
      f.chain.bls.verifySignatureSets.mockResolvedValue(false);
      await expect(f.executor.execute([block], false, reported)).resolves.toEqual([TopicValidatorResult.Reject]);
      expect(recovery).not.toHaveBeenCalled();
      expect(f.chain.seenBlockInputCache.getByBlock).not.toHaveBeenCalled();

      f.chain.bls.verifySignatureSets.mockResolvedValue(true);
      await expect(f.executor.execute([block], false, reported)).resolves.toEqual([TopicValidatorResult.Ignore]);
      expect(f.chain.bls.verifySignatureSets).toHaveBeenCalledTimes(2);
      expect(recovery).toHaveBeenCalledOnce();
      expect(recovery).toHaveBeenCalledWith(expect.objectContaining({blockInput, peer: "peer"}));
      expect(search).not.toHaveBeenCalled();
      await expect(f.executor.execute([block], false, reported)).resolves.toEqual([TopicValidatorResult.Ignore]);
      expect(recovery).toHaveBeenCalledOnce();

      // A known parent at the block's slot fails validation.
      signedBlock.message.slot = 3;
      block.msg.data = ssz.phase0.SignedBeaconBlock.serialize(signedBlock);
      f.chain.forkChoice.getBlockHexDefaultStatus.mockImplementation((root) =>
        root === blockInput.parentRootHex ? ({slot: 3} as ProtoBlock) : null
      );
      await expect(f.executor.execute([block], false, reported)).resolves.toEqual([TopicValidatorResult.Reject]);
      expect(recovery).toHaveBeenCalledOnce();
    } finally {
      f.executor.stop();
    }
  });

  it("rejects a non-attestation job containing more than one message", async () => {
    const f = fixture();
    try {
      await expect(f.executor.execute([message("first"), message("second")], false, reported)).rejects.toThrow(
        "native gossip validator job"
      );
      expect(f.single).not.toHaveBeenCalled();
    } finally {
      f.executor.stop();
    }
  });
});

describe("native gossip recovery through BlockInputSync", () => {
  function recoveryFixture(maxPendingBlocks = defaultSyncOptions.maxPendingBlocks) {
    const metrics = createMetricsTest();
    const f = fixture(metrics);
    const requests = vi.spyOn(metrics.blockInputSync.requests, "inc");
    const response = defer<Awaited<ReturnType<INetwork["sendBeaconBlocksByRoot"]>>>();
    const network = {
      events: new NetworkEventBus(),
      getConnectedPeers: vi.fn((): string[] => []),
      getConnectedPeerSyncMeta: (peerId: string) => ({
        peerId,
        client: "test",
        custodyColumns: [],
        earliestAvailableSlot: 0,
      }),
      custodyConfig: {sampledColumns: []},
      sendBeaconBlocksByRoot: vi.fn<INetwork["sendBeaconBlocksByRoot"]>(() => response.promise),
      reportPeer: vi.fn(),
    };
    const sync = new BlockInputSync(f.config, network as unknown as INetwork, f.chain, f.logger, metrics, {
      ...defaultSyncOptions,
      maxPendingBlocks,
    });
    sync.subscribeToNetwork();
    const connect = (peer: string): void => {
      network.events.emit(NetworkEvent.peerConnected, {
        peer,
        status: ssz.phase0.Status.defaultValue(),
        custodyColumns: [],
        clientAgent: "test",
      });
    };
    const close = (): void => {
      f.executor.stop();
      sync.close();
      response.resolve([]);
      requests.mockRestore();
    };
    return {...f, network, requests, connect, close};
  }

  it("limits one peer before sync admission and preserves an honest recovery", async () => {
    const f = recoveryFixture();
    const peer = await getRandPeerIdStr();
    const roots = Array.from({length: 102}, (_, index) => new Uint8Array(32).fill(index));
    try {
      f.executor.check(
        roots.slice(0, -1).map((root) => ({
          root,
          slot: 64n,
          peerId: peer,
          topic: "test",
        }))
      );
      const peerless = {slot: 64, root: toRootHex(roots[101])};
      f.executor.searchUnknownBlock(peerless, BlockInputSource.gossip);
      f.executor.searchUnknownBlock(peerless, BlockInputSource.gossip);
      expect(f.requests).toHaveBeenCalledTimes(5);
      expect(f.network.sendBeaconBlocksByRoot).not.toHaveBeenCalled();

      f.network.getConnectedPeers.mockReturnValue([peer]);
      f.connect(peer);
      expect(f.network.sendBeaconBlocksByRoot.mock.calls).toEqual([
        [peer, [roots[0]]],
        [peer, [roots[1]]],
      ]);
      f.executor.searchUnknownBlock(peerless, BlockInputSource.gossip);
      expect(f.network.sendBeaconBlocksByRoot).toHaveBeenCalledTimes(2);
      expect(f.requests).toHaveBeenCalledTimes(5);
    } finally {
      f.close();
    }
  });

  it("preserves later peer hints without duplicating downloads and stops forwarding recovery on shutdown", async () => {
    const f = recoveryFixture();
    const [fallback, preferred] = await Promise.all([getRandPeerIdStr(), getRandPeerIdStr()]);
    const root = new Uint8Array(32).fill(7);
    const slotRoot = {slot: 64, root: toRootHex(root)};
    try {
      for (let index = 0; index < 8; index++) {
        f.executor.searchUnknownBlock(slotRoot, BlockInputSource.gossip, `disconnected-${index}`);
      }
      f.executor.searchUnknownBlock(slotRoot, BlockInputSource.gossip, preferred);
      f.executor.searchUnknownBlock(slotRoot, BlockInputSource.gossip, preferred);
      f.executor.searchUnknownBlock(slotRoot, BlockInputSource.gossip);
      expect(f.requests).toHaveBeenCalledOnce();

      f.connect(fallback);
      f.connect(preferred);
      f.network.getConnectedPeers.mockReturnValue([fallback, preferred]);
      f.connect(preferred);
      expect(f.network.sendBeaconBlocksByRoot).toHaveBeenCalledExactlyOnceWith(preferred, [root]);
      f.executor.searchUnknownBlock(slotRoot, BlockInputSource.gossip, preferred);
      f.executor.searchUnknownBlock(slotRoot, BlockInputSource.gossip);
      expect(f.requests).toHaveBeenCalledOnce();
      expect(f.network.sendBeaconBlocksByRoot).toHaveBeenCalledOnce();

      const envelope = vi.fn();
      f.chain.emitter.on(ChainEvent.unknownEnvelopeBlockRoot, envelope);
      f.executor.stop();
      const next = {slot: 65, root: toRootHex(new Uint8Array(32).fill(8))};
      f.executor.searchUnknownBlock(next, BlockInputSource.gossip, preferred);
      f.executor.searchUnknownEnvelope(next, BlockInputSource.gossip, preferred);
      f.executor.check([
        {
          root: new Uint8Array(32).fill(9),
          slot: 65n,
          peerId: preferred,
          topic: "test",
        },
      ]);
      expect(envelope).not.toHaveBeenCalled();
      expect(f.requests).toHaveBeenCalledOnce();
      expect(f.network.sendBeaconBlocksByRoot).toHaveBeenCalledOnce();
    } finally {
      f.close();
    }
  });
});

it.each(["bls", "regen"] as const)("rechecks both validation blockers when %s recovers first", (first) => {
  const f = fixture();
  let bls = false;
  let regen = false;
  f.chain.blsThreadPoolCanAcceptWork.mockImplementation(() => bls);
  f.chain.regenCanAcceptWork = () => regen;
  expect(f.executor.ready()).toBe(false);
  if (first === "bls") bls = true;
  else regen = true;
  f.chain.emitter.emit(ChainEvent.validationCapacity);
  expect(f.wake).toHaveBeenCalledOnce();
  expect(f.executor.ready()).toBe(false);
  bls = true;
  regen = true;
  f.chain.emitter.emit(ChainEvent.validationCapacity);
  expect(f.wake).toHaveBeenCalledTimes(2);
  expect(f.executor.ready()).toBe(true);
  f.unsubscribe();
  f.chain.emitter.emit(ChainEvent.validationCapacity);
  expect(f.wake).toHaveBeenCalledTimes(2);
  f.executor.stop();
});
