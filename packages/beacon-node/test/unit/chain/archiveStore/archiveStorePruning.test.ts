import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {config} from "@lodestar/config/default";
import {testLogger} from "@lodestar/logger/test-utils";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {BeaconEngineEvent, BeaconEngineEventBus} from "../../../../src/chain/beaconEngine/events.js";
import {BeaconDb} from "../../../../src/db/index.js";
import {startIsolatedTmpBeaconDb} from "../../../utils/db.js";

describe("engine / state pruning progress", () => {
  const previousSlot = computeStartSlotAtEpoch(90);
  const nextSlot = computeStartSlotAtEpoch(100);
  let db: BeaconDb;
  let closeDb: () => Promise<void>;
  let events: BeaconEngineEventBus;
  let prune: (epoch: number) => Promise<number>;

  beforeEach(async () => {
    ({db, close: closeDb} = await startIsolatedTmpBeaconDb(config, "lodestar-archive-store-pruning-"));
    events = new BeaconEngineEventBus();
    const engine = Object.assign(Object.create(BeaconEngineCore.prototype) as BeaconEngineCore, {
      config,
      db,
      logger: testLogger(),
      metrics: null,
      events,
    });
    prune = (epoch) => engine.pruneHistory(epoch, epoch);
    await db.stateArchive.putBinary(0, new Uint8Array([0]));
    await db.stateArchive.putBinary(previousSlot, new Uint8Array([1]));
    await prune(98);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await closeDb();
  });

  it("reuses the startup cutoff and advances it after pruning a new state range", async () => {
    const keys = vi.spyOn(db.stateArchive, "keys");
    await prune(99);
    expect(keys.mock.calls.filter(([opts]) => opts?.gte !== undefined)).toEqual([]);
    await db.stateArchive.putBinary(nextSlot, new Uint8Array([2]));
    await prune(102);
    expect(await db.stateArchive.keys()).toEqual([nextSlot]);
    await prune(103);
    expect(keys.mock.calls.filter(([opts]) => opts?.gte !== undefined)).toEqual([[{gte: previousSlot, lt: nextSlot}]]);
  });

  it("prunes envelopes at the block-history cutoff, retaining the boundary", async () => {
    const epoch = config.MIN_EPOCHS_FOR_BLOCK_REQUESTS + 1;
    const cutoff = computeStartSlotAtEpoch(1);
    await db.executionPayloadEnvelopeArchive.putBinary(cutoff - 1, Uint8Array.of(1));
    await db.executionPayloadEnvelopeArchive.putBinary(cutoff, Uint8Array.of(2));
    expect(await prune(epoch)).toBe(cutoff);
    expect(await db.executionPayloadEnvelopeArchive.keys()).toEqual([cutoff]);
  });

  it("persists and publishes the serving floor before deletion, even if deletion fails", async () => {
    const cutoff = computeStartSlotAtEpoch(1);
    const observed: number[] = [];
    events.on(BeaconEngineEvent.earliestAvailableSlotUpdated, (slot) => observed.push(slot));
    const failure = new Error("deletion failed");
    vi.spyOn(db.blockArchive, "batchDeleteRange").mockImplementationOnce(async () => {
      expect(await db.earliestAvailableSlot.get()).toBe(cutoff);
      expect(observed).toEqual([cutoff]);
      throw failure;
    });
    await expect(prune(config.MIN_EPOCHS_FOR_BLOCK_REQUESTS + 1)).rejects.toBe(failure);
    expect(await db.earliestAvailableSlot.get()).toBe(cutoff);
  });

  it("does not publish or delete history when persisting the serving floor fails", async () => {
    const update = vi.fn();
    events.on(BeaconEngineEvent.earliestAvailableSlotUpdated, update);
    const blocks = vi.spyOn(db.blockArchive, "batchDeleteRange");
    const states = vi.spyOn(db.stateArchive, "batchDelete");
    const envelopes = vi.spyOn(db.executionPayloadEnvelopeArchive, "batchDelete");
    vi.spyOn(db.earliestAvailableSlot, "set").mockRejectedValueOnce(new Error("floor write failed"));
    await expect(prune(config.MIN_EPOCHS_FOR_BLOCK_REQUESTS + 1)).rejects.toThrow("floor write failed");
    expect(update).not.toHaveBeenCalled();
    expect(blocks).not.toHaveBeenCalled();
    expect(states).not.toHaveBeenCalled();
    expect(envelopes).not.toHaveBeenCalled();
  });

  it("retries the same state range when deletion fails", async () => {
    await db.stateArchive.putBinary(nextSlot, new Uint8Array([2]));
    const keys = vi.spyOn(db.stateArchive, "keys");
    const error = new Error("State deletion failed");
    vi.spyOn(db.stateArchive, "batchDelete").mockRejectedValueOnce(error);
    await expect(prune(102)).rejects.toBe(error);
    expect(await db.stateArchive.keys()).toEqual([previousSlot, nextSlot]);
    await prune(102);
    expect(keys.mock.calls.filter(([opts]) => opts?.gte !== undefined)).toEqual([
      [{gte: previousSlot, lt: nextSlot}],
      [{gte: previousSlot, lt: nextSlot}],
    ]);
    expect(await db.stateArchive.keys()).toEqual([nextSlot]);
  });
});
