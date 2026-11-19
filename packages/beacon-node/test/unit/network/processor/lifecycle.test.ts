import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {gossipQueues} from "@lodestar/native/gossip-queues";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ChainEvent} from "../../../../src/chain/emitter.js";
import {IBeaconChain} from "../../../../src/chain/interface.js";
import {INetworkCore} from "../../../../src/network/core/index.js";
import {NetworkEvent, NetworkEventBus, NetworkEventData} from "../../../../src/network/events.js";
import {
  BatchGossipHandlerFn,
  GossipHandlerFn,
  GossipHandlers,
  GossipTopic,
  GossipType,
} from "../../../../src/network/gossip/interface.js";
import {stringifyGossipTopic} from "../../../../src/network/gossip/topic.js";
import {AggregatorTracker} from "../../../../src/network/processor/aggregatorTracker.js";
import {NetworkProcessor} from "../../../../src/network/processor/index.js";
import {NativeGossipProcessor} from "../../../../src/network/processor/native.js";
import {offerGossip} from "../../../../src/network/processor/nativeIngress.js";
import {ClockEvent} from "../../../../src/util/clock.js";
import {PeerIdStr} from "../../../../src/util/peerId.js";
import {ClockStopped} from "../../../mocks/clock.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";
import {getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {getMockedBeaconDb} from "../../../mocks/mockedBeaconDb.js";

const root = new Uint8Array(32).fill(1);
const rootHex = toRootHex(root);
const source = "16Uiu2HAmGossipLifecyclePeer" as PeerIdStr;
type Result = NetworkEventData[NetworkEvent.gossipMessageValidationResult];
type IncomingMessage = NetworkEventData[NetworkEvent.pendingGossipsubMessage];

function message(
  id: number,
  topic: GossipTopic = {type: GossipType.voluntary_exit, boundary: {fork: ForkName.phase0, epoch: 0}},
  data: Uint8Array = new Uint8Array()
): IncomingMessage {
  return {
    topic,
    msg: {type: "unsigned", topic: topic.type, data},
    msgId: String(id),
    propagationSource: source,
    clientAgent: "test",
    clientVersion: "test",
    seenTimestampSec: 0,
    startProcessUnixSec: null,
  };
}

function attestation(id: number, payload = false, slot = 64): IncomingMessage {
  const att = ssz.electra.SingleAttestation.defaultValue();
  att.data.slot = slot;
  att.data.beaconBlockRoot = root;
  att.data.index = payload ? 1 : 0;
  return message(
    id,
    {type: GossipType.beacon_attestation, subnet: 0, boundary: {fork: ForkName.gloas, epoch: 0}},
    ssz.electra.SingleAttestation.serialize(att)
  );
}

function fixture(native = false) {
  const clock = new ClockStopped(64);
  const events = new NetworkEventBus();
  const logger = getMockedLogger();
  const baseChain = getMockedBeaconChain();
  const blsThreadPoolCanAcceptWork = vi.fn(() => true);
  const hasBlockHexUnsafe = vi.fn(() => true);
  const hasPayloadHexUnsafe = vi.fn(() => true);
  const chain: IBeaconChain = {
    ...baseChain,
    clock,
    blsThreadPoolCanAcceptWork,
    regenCanAcceptWork: () => true,
    seenBlock: () => false,
    seenPayloadEnvelope: () => false,
    forkChoice: {...baseChain.forkChoice, hasBlockHexUnsafe, hasPayloadHexUnsafe},
  };
  const single = vi.fn<GossipHandlerFn>(async () => {});
  const batch = vi.fn<BatchGossipHandlerFn>(async (items) => items.map(() => null));
  const handlers: GossipHandlers = {
    beacon_block: single,
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
    inclusion_list: single,
  };
  const results: Result[] = [];
  events.on(NetworkEvent.gossipMessageValidationResult, (result) => results.push(result));
  const core = {reportPeer: vi.fn()};
  const config = createBeaconConfig(defaultConfig, new Uint8Array(32));
  const modules = {
    chain,
    db: getMockedBeaconDb(),
    config,
    aggregatorTracker: new AggregatorTracker(),
    core: core as unknown as INetworkCore,
    events,
    logger,
    metrics: null,
    gossipHandlers: handlers,
  };
  const id = native ? gossipQueues.create(1024, 64) : undefined;
  const processor = id === undefined ? new NetworkProcessor(modules, {}) : new NativeGossipProcessor(id, modules, {});
  return {
    processor,
    clock,
    events,
    chain,
    logger,
    single,
    batch,
    results,
    core,
    blsThreadPoolCanAcceptWork,
    hasBlockHexUnsafe,
    hasPayloadHexUnsafe,
    dispatch: (msg: IncomingMessage) => {
      if (id === undefined) events.emit(NetworkEvent.pendingGossipsubMessage, msg);
      else {
        msg.msg.topic = stringifyGossipTopic(config, msg.topic);
        if (offerGossip(id, clock, msg)) events.emit(NetworkEvent.gossipQueueReady, null);
      }
    },
  };
}

describe("NetworkProcessor lifecycle", () => {
  const processors: (NetworkProcessor | NativeGossipProcessor)[] = [];
  function setup() {
    const f = fixture();
    processors.push(f.processor);
    return f;
  }

  beforeEach(() => vi.useFakeTimers({now: 0}));
  afterEach(async () => {
    for (const processor of processors) await processor.stop();
    processors.length = 0;
    await vi.runAllTimersAsync();
    vi.useRealTimers();
  });

  it("stop removes the clock listener once and takes no later ingress", async () => {
    const f = setup();
    expect(f.clock.listenerCount(ClockEvent.slot)).toBe(1);
    await f.processor.stop();
    await f.processor.stop();
    expect(f.clock.listenerCount(ClockEvent.slot)).toBe(0);
    f.dispatch(message(1));
    await vi.runAllTimersAsync();
    expect(f.processor.dumpGossipQueue(GossipType.voluntary_exit)).toEqual([]);
    expect(f.single).not.toHaveBeenCalled();
    expect(f.results).toEqual([]);
  });

  it.each(["stop", "dropAllJobs"] as const)(
    "%s clears awaiting and queued work without resurrection",
    async (action) => {
      const f = setup();
      f.blsThreadPoolCanAcceptWork.mockReturnValue(false);
      f.hasBlockHexUnsafe.mockReturnValue(false);
      f.dispatch(message(1));
      f.dispatch(attestation(2));
      f.hasBlockHexUnsafe.mockReturnValue(true);
      f.hasPayloadHexUnsafe.mockReturnValue(false);
      f.dispatch(attestation(3, true));
      expect(f.processor.dumpGossipQueue(GossipType.voluntary_exit)).toHaveLength(1);
      await f.processor[action]();
      await f.processor[action]();
      f.blsThreadPoolCanAcceptWork.mockReturnValue(true);
      f.chain.emitter.emit(routes.events.EventType.block, {block: rootHex, executionOptimistic: false, slot: 64});
      f.chain.emitter.emit(routes.events.EventType.executionPayload, {
        blockRoot: rootHex,
        slot: 64,
        builderIndex: 0,
        blockHash: rootHex,
        executionOptimistic: false,
      });
      await vi.runAllTimersAsync();
      expect(f.processor.dumpGossipQueue(GossipType.voluntary_exit)).toHaveLength(0);
      expect(f.processor.dumpGossipQueue(GossipType.beacon_attestation)).toHaveLength(0);
      expect(f.single).not.toHaveBeenCalled();
      expect(f.batch).not.toHaveBeenCalled();
    }
  );

  it.each(["stop", "dropAllJobs"] as const)("%s drops a reprocessing batch across its yield", async (action) => {
    const f = setup();
    f.hasBlockHexUnsafe.mockReturnValue(false);
    f.blsThreadPoolCanAcceptWork.mockReturnValue(false);
    for (let id = 0; id <= 1024; id++) f.dispatch(attestation(id));
    f.chain.emitter.emit(routes.events.EventType.block, {block: rootHex, executionOptimistic: false, slot: 64});
    // The first 1024 moved to the queue before the batch yields
    expect(f.processor.dumpGossipQueue(GossipType.beacon_attestation)).toHaveLength(1024);
    await f.processor[action]();
    await vi.advanceTimersByTimeAsync(51);
    expect(f.processor.dumpGossipQueue(GossipType.beacon_attestation)).toHaveLength(0);
    if (action === "dropAllJobs") {
      f.hasBlockHexUnsafe.mockReturnValue(true);
      f.dispatch(attestation(1025));
      expect(f.processor.dumpGossipQueue(GossipType.beacon_attestation)).toHaveLength(1);
    }
  });
});

it("resumes native validation on capacity and preserves the libp2p verdict receipt", async () => {
  const f = fixture(true);
  try {
    f.blsThreadPoolCanAcceptWork.mockReturnValue(false);
    f.dispatch(message(17));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(f.single).not.toHaveBeenCalled();
    expect(f.processor.dumpGossipQueue(GossipType.voluntary_exit)).toHaveLength(1);
    f.blsThreadPoolCanAcceptWork.mockReturnValue(true);
    f.chain.emitter.emit(ChainEvent.validationCapacity);
    await vi.waitFor(() => expect(f.results).toEqual([{msgId: "17", propagationSource: source, acceptance: "accept"}]));
    expect(f.single).toHaveBeenCalledTimes(1);
  } finally {
    await f.processor.stop();
  }
});

it("retains attestations for an unknown block and validates the group on import", async () => {
  const f = fixture(true);
  try {
    const att = ssz.phase0.Attestation.defaultValue();
    att.data.slot = f.clock.currentSlot;
    att.data.beaconBlockRoot = root;
    const bytes = ssz.phase0.Attestation.serialize(att);
    const topic: GossipTopic = {
      type: GossipType.beacon_attestation,
      subnet: 0,
      boundary: {fork: ForkName.phase0, epoch: 0},
    };
    f.hasBlockHexUnsafe.mockReturnValue(false);
    f.dispatch(message(18, topic, bytes));
    f.dispatch(message(19, topic, bytes));
    await vi.waitFor(() => expect(f.hasBlockHexUnsafe).toHaveBeenCalledWith(rootHex));
    expect(f.batch).not.toHaveBeenCalled();
    f.hasBlockHexUnsafe.mockReturnValue(true);
    f.chain.emitter.emit(routes.events.EventType.block, {block: rootHex, executionOptimistic: false, slot: 64});
    await vi.waitFor(() => expect(f.results).toHaveLength(2));
    expect(f.batch).toHaveBeenCalledTimes(1);
    expect(f.results.map((result) => result.msgId).sort()).toEqual(["18", "19"]);
    for (const result of f.results) expect(result.acceptance, result.msgId).toBe("accept");
  } finally {
    await f.processor.stop();
  }
});

it("returns Reject for an unreadable block slot without calling the handler", async () => {
  const f = fixture(true);
  try {
    f.dispatch(message(20, {type: GossipType.beacon_block, boundary: {fork: ForkName.phase0, epoch: 0}}));
    await vi.waitFor(() => expect(f.results).toEqual([{msgId: "20", propagationSource: source, acceptance: "reject"}]));
    expect(f.single).not.toHaveBeenCalled();
    expect(f.core.reportPeer).toHaveBeenCalledTimes(1);
  } finally {
    await f.processor.stop();
  }
});
