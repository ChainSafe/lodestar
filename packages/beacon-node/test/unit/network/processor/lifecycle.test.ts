import {TopicValidatorResult} from "@libp2p/gossipsub";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {
  AttestationError,
  AttestationErrorCode,
  GossipAction,
  GossipActionError,
} from "../../../../src/chain/errors/index.js";
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return {promise, resolve};
}

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

function fixture(completeGossipWork?: boolean) {
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
    {completeGossipWork}
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

function expectResults(results: Result[], ids: number[], acceptance = TopicValidatorResult.Ignore): void {
  expect(results).toHaveLength(ids.length);
  expect(new Set(results.map((result) => result.msgId)).size).toBe(ids.length);
  expect(results).toEqual(ids.map((id) => ({msgId: String(id), propagationSource: source, acceptance})));
}

describe("NetworkProcessor complete gossip lifecycle", () => {
  const processors: NetworkProcessor[] = [];
  function setup(completeGossipWork: boolean | undefined = true) {
    const f = fixture(completeGossipWork);
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

  it("retires old preprocessing input once and defers the terminal event", async () => {
    const f = setup();
    const old = attestation(1, false, 0);
    f.dispatch(old);
    f.dispatch(old);
    expect(f.results).toEqual([]);
    await vi.runAllTimersAsync();
    expectResults(f.results, [1]);
  });

  it.each([false, true])("retires unknown-root expiry, payload=%s", async (payload) => {
    const f = setup();
    f.hasBlockHexUnsafe.mockReturnValue(payload);
    f.hasPayloadHexUnsafe.mockReturnValue(false);
    f.dispatch(attestation(1, payload));
    f.clock.emit(ClockEvent.slot, 67);
    f.clock.emit(ClockEvent.slot, 68);
    await vi.runAllTimersAsync();
    expectResults(f.results, [1]);
  });

  it.each([
    {payload: false, capacity: 16_384},
    {payload: true, capacity: 1024},
  ])("rejects at the declared awaiting capacity: $capacity", async ({payload, capacity}) => {
    const f = setup();
    f.hasBlockHexUnsafe.mockReturnValue(payload);
    f.hasPayloadHexUnsafe.mockReturnValue(false);
    for (let id = 0; id <= capacity; id++) f.dispatch(attestation(id, payload));
    await vi.runAllTimersAsync();
    expectResults(f.results, [capacity]);
    vi.useRealTimers();
    const retired = new Promise<void>((resolve) => {
      f.events.on(NetworkEvent.gossipMessageValidationResult, () => {
        if (f.results.length === capacity + 1) resolve();
      });
    });
    f.processor.dropAllJobs();
    await retired;
    vi.useFakeTimers({now: 0});
    expectResults(f.results, [capacity, ...Array.from({length: capacity}, (_, id) => id)]);
  });

  it("retires FIFO overflow and clears queued jobs once", async () => {
    const f = setup();
    f.blsThreadPoolCanAcceptWork.mockReturnValue(false);
    const topic: GossipTopic = {
      type: GossipType.light_client_finality_update,
      boundary: {fork: ForkName.altair, epoch: 0},
    };
    for (let id = 0; id <= 1024; id++) f.dispatch(message(id, topic));
    await vi.runAllTimersAsync();
    expectResults(f.results, [1024]);
    f.processor.dropAllJobs();
    f.processor.dropAllJobs();
    expect(f.processor.dumpGossipQueue(topic.type)).toEqual([]);
    await vi.runAllTimersAsync();
    expectResults(f.results, [1024, ...Array.from({length: 1024}, (_, id) => 1023 - id)]);
  });

  it("retires an unindexable attestation", async () => {
    const f = setup();
    f.dispatch(
      message(1, {type: GossipType.beacon_attestation, subnet: 0, boundary: {fork: ForkName.gloas, epoch: 0}})
    );
    await vi.runAllTimersAsync();
    expectResults(f.results, [1]);
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
      await f.processor[action]();
      await f.processor[action]();
      f.chain.emitter.emit(routes.events.EventType.block, {block: rootHex, executionOptimistic: false, slot: 64});
      f.chain.emitter.emit(routes.events.EventType.executionPayload, {
        blockRoot: rootHex,
        slot: 64,
        builderIndex: 0,
        blockHash: rootHex,
        executionOptimistic: false,
      });
      await vi.runAllTimersAsync();
      expectResults(f.results, [1, 2, 3]);
      expect(f.processor.dumpGossipQueue(GossipType.beacon_attestation)).toHaveLength(0);
    }
  );

  it("stop removes the clock listener and rejects later ingress", async () => {
    const f = setup();
    expect(f.clock.listenerCount(ClockEvent.slot)).toBe(1);
    await f.processor.stop();
    await f.processor.stop();
    expect(f.clock.listenerCount(ClockEvent.slot)).toBe(0);
    f.dispatch(message(1));
    await vi.runAllTimersAsync();
    expect(f.results).toEqual([]);
  });

  it.each([TopicValidatorResult.Accept, TopicValidatorResult.Reject, TopicValidatorResult.Ignore])(
    "preserves single validator verdict %s",
    async (acceptance) => {
      const f = setup();
      if (acceptance !== TopicValidatorResult.Accept) {
        f.single.mockRejectedValue(
          new GossipActionError(
            acceptance === TopicValidatorResult.Reject ? GossipAction.REJECT : GossipAction.IGNORE,
            {code: "TEST_VERDICT"}
          )
        );
      }
      f.dispatch(message(1));
      expect(f.results).toEqual([]);
      await vi.runAllTimersAsync();
      expectResults(f.results, [1], acceptance);
    }
  );

  it("preserves mixed batch verdicts and transfers each original object once", async () => {
    const f = setup();
    f.batch.mockResolvedValue([
      null,
      new AttestationError(GossipAction.REJECT, {code: AttestationErrorCode.INVALID_SIGNATURE}),
      new AttestationError(GossipAction.IGNORE, {code: AttestationErrorCode.INVALID_SIGNATURE}),
    ]);
    f.blsThreadPoolCanAcceptWork.mockReturnValue(false);
    for (const id of [1, 2, 3]) f.dispatch(attestation(id));
    await vi.advanceTimersByTimeAsync(50);
    f.blsThreadPoolCanAcceptWork.mockReturnValue(true);
    f.dispatch(message(4));
    await vi.runAllTimersAsync();
    expect(f.results).toEqual([
      {msgId: "4", propagationSource: source, acceptance: TopicValidatorResult.Accept},
      {msgId: "3", propagationSource: source, acceptance: TopicValidatorResult.Accept},
      {msgId: "2", propagationSource: source, acceptance: TopicValidatorResult.Reject},
      {msgId: "1", propagationSource: source, acceptance: TopicValidatorResult.Ignore},
    ]);
  });

  it.each([false, true])(
    "stop resolves before held validation and retires only after settlement, batch=%s",
    async (batch) => {
      const f = setup();
      const held = deferred<void>();
      if (batch)
        f.batch.mockImplementation(async (items) => {
          await held.promise;
          return items.map(() => null);
        });
      else f.single.mockImplementation(() => held.promise);
      if (batch) {
        f.dispatch(attestation(1));
        await vi.advanceTimersByTimeAsync(50);
        f.dispatch(message(2));
        await vi.runAllTimersAsync();
        expectResults(f.results, [2], TopicValidatorResult.Accept);
        f.results.length = 0;
      } else f.dispatch(message(1));
      await f.processor.stop();
      await vi.runAllTimersAsync();
      expect(f.results).toEqual([]);
      held.resolve();
      await vi.runAllTimersAsync();
      expectResults(f.results, [1], TopicValidatorResult.Accept);
    }
  );

  it.each([false, true])(
    "retires rejected validator promises even when diagnostic logging throws, batch=%s",
    async (batch) => {
      const f = setup();
      const failure = new Error("validator fixture failure");
      f.logger.debug.mockImplementation(() => {
        throw failure;
      });
      if (batch) {
        f.batch.mockRejectedValue(failure);
        f.blsThreadPoolCanAcceptWork.mockReturnValue(false);
        f.dispatch(attestation(1));
        f.dispatch(attestation(2));
        await vi.advanceTimersByTimeAsync(50);
        f.blsThreadPoolCanAcceptWork.mockReturnValue(true);
        f.dispatch(message(3));
      } else {
        f.single.mockRejectedValue(failure);
        f.dispatch(message(1));
      }
      await vi.runAllTimersAsync();
      if (batch) {
        expect(f.results[0]).toEqual({msgId: "3", propagationSource: source, acceptance: TopicValidatorResult.Accept});
        expectResults(f.results.slice(1), [2, 1]);
      } else expectResults(f.results, [1]);
      expect(f.logger.error).toHaveBeenCalledOnce();
    }
  );

  it.each(["stop", "dropAllJobs"] as const)(
    "%s invalidates a detached reprocessing batch across its yield",
    async (action) => {
      const f = setup();
      f.hasBlockHexUnsafe.mockReturnValue(false);
      f.blsThreadPoolCanAcceptWork.mockReturnValue(false);
      for (let id = 0; id <= 1024; id++) f.dispatch(attestation(id));
      f.chain.emitter.emit(routes.events.EventType.block, {block: rootHex, executionOptimistic: false, slot: 64});
      expect(f.processor.dumpGossipQueue(GossipType.beacon_attestation)).toHaveLength(1024);
      await f.processor[action]();
      await vi.advanceTimersByTimeAsync(51);
      expect(f.processor.dumpGossipQueue(GossipType.beacon_attestation)).toHaveLength(0);
      expectResults(
        f.results,
        Array.from({length: 1025}, (_, id) => id)
      );
      if (action === "dropAllJobs") {
        f.hasBlockHexUnsafe.mockReturnValue(true);
        f.dispatch(attestation(1025));
        expect(f.processor.dumpGossipQueue(GossipType.beacon_attestation)).toHaveLength(1);
      }
    }
  );

  it("legacy defaults retain silent discard behavior and ordinary validation", async () => {
    const f = fixture();
    processors.push(f.processor);
    f.dispatch(attestation(1, false, 0));
    f.dispatch(
      message(2, {type: GossipType.beacon_attestation, subnet: 0, boundary: {fork: ForkName.gloas, epoch: 0}})
    );
    f.blsThreadPoolCanAcceptWork.mockReturnValue(false);
    f.dispatch(message(3));
    f.processor.dropAllJobs();
    f.blsThreadPoolCanAcceptWork.mockReturnValue(true);
    f.dispatch(message(4));
    await vi.runAllTimersAsync();
    expectResults(f.results, [4], TopicValidatorResult.Accept);
  });
});
