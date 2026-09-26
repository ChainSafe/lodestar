import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../../src/chain/interface.js";
import {INetworkCore} from "../../../../src/network/core/index.js";
import {NetworkEvent, NetworkEventBus, NetworkEventData} from "../../../../src/network/events.js";
import {
  BatchGossipHandlerFn,
  GossipHandlers,
  GossipTopic,
  GossipType,
} from "../../../../src/network/gossip/interface.js";
import {AggregatorTracker} from "../../../../src/network/processor/aggregatorTracker.js";
import {NetworkProcessor} from "../../../../src/network/processor/index.js";
import {PendingGossipsubMessage} from "../../../../src/network/processor/types.js";
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

function message(
  id: number,
  topic: GossipTopic = {type: GossipType.voluntary_exit, boundary: {fork: ForkName.phase0, epoch: 0}},
  data: Uint8Array = new Uint8Array()
): PendingGossipsubMessage {
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

function attestation(id: number, payload = false, slot = 64): PendingGossipsubMessage {
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

function fixture() {
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
  const single = vi.fn<() => Promise<void>>(async () => {});
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
  const results: Result[] = [];
  events.on(NetworkEvent.gossipMessageValidationResult, (result) => results.push(result));
  const processor = new NetworkProcessor(
    {
      chain,
      db: getMockedBeaconDb(),
      config: createBeaconConfig(defaultConfig, new Uint8Array(32)),
      aggregatorTracker: new AggregatorTracker(),
      core: {} as INetworkCore,
      events,
      logger,
      metrics: null,
      gossipHandlers: handlers,
    },
    {}
  );
  return {
    processor,
    clock,
    events,
    chain,
    logger,
    single,
    batch,
    results,
    blsThreadPoolCanAcceptWork,
    hasBlockHexUnsafe,
    hasPayloadHexUnsafe,
    dispatch: (msg: PendingGossipsubMessage) => events.emit(NetworkEvent.pendingGossipsubMessage, msg),
  };
}

describe("NetworkProcessor lifecycle", () => {
  const processors: NetworkProcessor[] = [];
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
