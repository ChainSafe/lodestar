import {beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {PayloadStatus} from "@lodestar/fork-choice";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BeaconEngine} from "../../../../src/chain/beaconEngine/beaconEngine.js";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {BeaconEngineEvent, BeaconEngineEventBus, ChainReorg} from "../../../../src/chain/beaconEngine/events.js";
import {ChainEvent, ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {SerializedCache} from "../../../../src/util/serializedCache.js";
import {ClockStopped} from "../../../mocks/clock.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

describe("BeaconEngine event forwarding", () => {
  const config = createBeaconConfig(
    {ALTAIR_FORK_EPOCH: 0, BELLATRIX_FORK_EPOCH: 0, CAPELLA_FORK_EPOCH: 1, DENEB_FORK_EPOCH: 2},
    Buffer.alloc(32)
  );
  const slot = 2 * SLOTS_PER_EPOCH - 1;
  const root = toRootHex(Buffer.alloc(32, 1));
  const previousRoot = toRootHex(Buffer.alloc(32, 2));
  const reorg: ChainReorg = {
    slot,
    depth: 2,
    epoch: 1,
    oldHeadBlock: previousRoot,
    newHeadBlock: root,
    oldHeadState: previousRoot,
    newHeadState: root,
    executionOptimistic: true,
  };
  const payload = {slot, builderIndex: 1, blockRoot: root, blockHash: root, executionOptimistic: false};
  let engine: BeaconEngine;
  let events: BeaconEngineEventBus;
  let emitter: ChainEventEmitter;
  let clock: ClockStopped;
  const close = vi.fn<() => Promise<void>>();

  beforeEach(() => {
    close.mockReset().mockResolvedValue(undefined);
    events = new BeaconEngineEventBus();
    emitter = new ChainEventEmitter();
    clock = new ClockStopped(slot);
    const core = Object.assign(Object.create(BeaconEngineCore.prototype) as BeaconEngineCore, {
      emitter: events,
      close,
    });
    engine = new BeaconEngine({core, config, emitter, clock, serializedCache: new SerializedCache()});
  });

  it("publishes a produced slashing to SSE and gossip in order", () => {
    const slashing = ssz.phase0.ProposerSlashing.defaultValue();
    slashing.signedHeader1.message.slot = 100n;
    const observed: string[] = [];
    emitter.on(routes.events.EventType.proposerSlashing, (data) => {
      expect(data).toEqual(slashing);
      observed.push("sse");
    });
    emitter.on(ChainEvent.publishProposerSlashing, (data) => {
      expect(data).toEqual(slashing);
      observed.push("gossip");
    });
    events.emit(BeaconEngineEvent.proposerSlashingProduced, structuredClone(slashing));
    expect(observed).toEqual(["sse", "gossip"]);
  });

  it("preserves repeated fast confirmations and reorg metadata", () => {
    const onReorg = vi.fn();
    const onConfirmation = vi.fn();
    emitter.on(routes.events.EventType.chainReorg, onReorg);
    emitter.on(routes.events.EventType.fastConfirmation, onConfirmation);
    const confirmation = {block: root, slot, currentSlot: slot + 1};
    events.emit(BeaconEngineEvent.chainReorg, structuredClone(reorg));
    events.emit(BeaconEngineEvent.fastConfirmation, structuredClone(confirmation));
    events.emit(BeaconEngineEvent.fastConfirmation, {...confirmation, currentSlot: slot + 2});
    expect(onReorg).toHaveBeenCalledExactlyOnceWith(reorg);
    expect(onConfirmation.mock.calls).toEqual([[confirmation], [{...confirmation, currentSlot: slot + 2}]]);
  });

  it("uses the main-thread clock to filter payload imports at the 64-slot boundary", () => {
    const onPayload = vi.fn();
    emitter.on(routes.events.EventType.executionPayload, onPayload);
    clock.setSlot(slot + 63);
    events.emit(BeaconEngineEvent.executionPayloadImported, structuredClone(payload));
    expect(onPayload).toHaveBeenCalledExactlyOnceWith(payload);
    clock.setSlot(slot + 64);
    events.emit(BeaconEngineEvent.executionPayloadImported, structuredClone(payload));
    expect(onPayload).toHaveBeenCalledOnce();
  });

  it.each(["optimistic", "finality"] as const)(
    "decodes each %s notification with the attested fork and restores bit arrays",
    (kind) => {
      const type =
        kind === "optimistic" ? ssz.capella.LightClientOptimisticUpdate : ssz.capella.LightClientFinalityUpdate;
      const notification =
        kind === "optimistic"
          ? BeaconEngineEvent.lightClientOptimisticUpdate
          : BeaconEngineEvent.lightClientFinalityUpdate;
      const topic =
        kind === "optimistic"
          ? routes.events.EventType.lightClientOptimisticUpdate
          : routes.events.EventType.lightClientFinalityUpdate;
      const onUpdate = vi.fn();
      emitter.on(topic, onUpdate);
      const update = ssz.capella.LightClientFinalityUpdate.defaultValue();
      update.attestedHeader.beacon.slot = slot;
      update.signatureSlot = slot + 1;
      update.syncAggregate.syncCommitteeBits.set(0, true);
      events.emit(notification, structuredClone({data: type.serialize(update), slot}));
      update.syncAggregate.syncCommitteeBits.set(1, true);
      events.emit(notification, structuredClone({data: type.serialize(update), slot}));

      expect(onUpdate).toHaveBeenCalledTimes(2);
      const first = onUpdate.mock.calls[0][0];
      const second = onUpdate.mock.calls[1][0];
      expect(first.version).toBe(ForkName.capella);
      expect(second.version).toBe(ForkName.capella);
      expect(first.data.syncAggregate.syncCommitteeBits.get(0)).toBe(true);
      expect(first.data.syncAggregate.syncCommitteeBits.get(1)).toBe(false);
      expect(second.data.syncAggregate.syncCommitteeBits.get(1)).toBe(true);
      expect(type.serialize(second.data)).toEqual(type.serialize(update));
    }
  );

  it.each([false, true])("detaches all forwarding after close, including failure=%s", async (failClose) => {
    if (failClose) close.mockRejectedValueOnce(Error("close failed"));
    if (failClose) await expect(engine.close()).rejects.toThrow("close failed");
    else await engine.close();
    const emit = vi.spyOn(emitter, "emit");
    const coreListener = vi.fn();
    events.on(BeaconEngineEvent.chainReorg, coreListener);

    const checkpoint = {epoch: 0, root: Buffer.alloc(32, 1), rootHex: root};
    events.emit(BeaconEngineEvent.chainViewUpdated, {
      revision: 1,
      head: generateProtoBlock({slot, blockRoot: root}),
      justified: checkpoint,
      finalized: checkpoint,
      blocks: [],
    });
    events.emit(BeaconEngineEvent.earliestAvailableSlotUpdated, slot);
    events.emit(BeaconEngineEvent.fatalError, Error("core failed"));
    events.emit(BeaconEngineEvent.builderRegistered, "https://builder.example.com");
    events.emit(BeaconEngineEvent.headUpdated, {
      slot,
      blockRoot: root,
      stateRoot: root,
      payloadStatus: PayloadStatus.FULL,
      headRootChanged: true,
      epochTransition: false,
      previousDutyDependentRoot: previousRoot,
      currentDutyDependentRoot: root,
      executionOptimistic: false,
    });
    events.emit(BeaconEngineEvent.chainReorg, reorg);
    events.emit(BeaconEngineEvent.proposerSlashingProduced, ssz.phase0.ProposerSlashing.defaultValue());
    events.emit(BeaconEngineEvent.fastConfirmation, {block: root, slot, currentSlot: slot});
    events.emit(BeaconEngineEvent.executionPayloadImported, payload);
    events.emit(BeaconEngineEvent.lightClientOptimisticUpdate, {
      slot,
      data: ssz.capella.LightClientOptimisticUpdate.serialize(ssz.capella.LightClientOptimisticUpdate.defaultValue()),
    });
    events.emit(BeaconEngineEvent.lightClientFinalityUpdate, {
      slot,
      data: ssz.capella.LightClientFinalityUpdate.serialize(ssz.capella.LightClientFinalityUpdate.defaultValue()),
    });
    expect(emit).not.toHaveBeenCalled();
    expect(coreListener).toHaveBeenCalledExactlyOnceWith(reorg);
  });
});
