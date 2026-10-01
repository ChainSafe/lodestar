import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {config} from "@lodestar/config/default";
import {testLogger} from "@lodestar/logger/test-utils";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {pruneHistory} from "../../../../src/chain/archiveStore/utils/pruneHistory.js";
import {BeaconDb} from "../../../../src/db/index.js";
import {startIsolatedTmpBeaconDb} from "../../../utils/db.js";

describe("chain / archiveStore / pruneHistory", () => {
  let db: BeaconDb;
  let closeDb: () => Promise<void>;

  beforeEach(async () => {
    ({db, close: closeDb} = await startIsolatedTmpBeaconDb(config, "lodestar-prune-history-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await closeDb();
  });

  it("prunes blocks and execution payload envelopes older than MIN_EPOCHS_FOR_BLOCK_REQUESTS", async () => {
    const currentEpoch = config.MIN_EPOCHS_FOR_BLOCK_REQUESTS + 10;
    const finalizedEpoch = currentEpoch - 2;
    const cutoffSlot = computeStartSlotAtEpoch(currentEpoch - config.MIN_EPOCHS_FOR_BLOCK_REQUESTS);
    const slots = [0, cutoffSlot - 1, cutoffSlot, cutoffSlot + 100];

    await db.blockArchive.batchPut(
      slots.map((slot) => {
        const block = ssz.phase0.SignedBeaconBlock.defaultValue();
        block.message.slot = slot;
        return {key: slot, value: block};
      })
    );
    await db.executionPayloadEnvelopeArchive.batchPutBinary(
      slots.map((slot) => {
        const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
        envelope.message.payload.slotNumber = slot;
        return {key: slot, value: ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope)};
      })
    );

    const {blockCutoffSlot} = await pruneHistory(config, db, testLogger(), null, finalizedEpoch, currentEpoch);

    expect(blockCutoffSlot).toBe(cutoffSlot);
    expect(await db.blockArchive.keys()).toEqual([cutoffSlot, cutoffSlot + 100]);
    expect(await db.executionPayloadEnvelopeArchive.keys()).toEqual([cutoffSlot, cutoffSlot + 100]);
  });

  it("prunes archived states before the finalized epoch", async () => {
    const currentEpoch = 100;
    const finalizedEpoch = currentEpoch - 2;
    const finalizedSlot = computeStartSlotAtEpoch(finalizedEpoch);
    const slots = [0, computeStartSlotAtEpoch(finalizedEpoch - 64), finalizedSlot - 1, finalizedSlot];

    await Promise.all(slots.map((slot) => db.stateArchive.putBinary(slot, new Uint8Array([1]))));

    await pruneHistory(config, db, testLogger(), null, finalizedEpoch, currentEpoch);

    expect(await db.stateArchive.keys()).toEqual([finalizedSlot]);
  });

  it("keeps the latest archived state when it trails the finalized epoch", async () => {
    const currentEpoch = 100;
    const finalizedEpoch = currentEpoch - 2;
    const lastArchivedSlot = computeStartSlotAtEpoch(finalizedEpoch - 8);
    const slots = [0, computeStartSlotAtEpoch(finalizedEpoch - 40), lastArchivedSlot];

    await Promise.all(slots.map((slot) => db.stateArchive.putBinary(slot, new Uint8Array([1]))));

    await pruneHistory(config, db, testLogger(), null, finalizedEpoch, currentEpoch);

    expect(await db.stateArchive.keys()).toEqual([lastArchivedSlot]);
  });

  it("skips state scans until the cutoff advances", async () => {
    const lastArchivedSlot = computeStartSlotAtEpoch(90);
    await db.stateArchive.putBinary(lastArchivedSlot, new Uint8Array([1]));
    await pruneHistory(config, db, testLogger(), null, 98, 100);
    const keys = vi.spyOn(db.stateArchive, "keys");

    await pruneHistory(config, db, testLogger(), null, 99, 101, lastArchivedSlot);

    expect(keys.mock.calls.filter(([opts]) => opts?.gte !== undefined)).toEqual([]);
    expect(await db.stateArchive.keys()).toEqual([lastArchivedSlot]);
  });

  it("resumes at the previous cutoff and prunes the previous restart anchor", async () => {
    const lastArchivedSlot = computeStartSlotAtEpoch(90);
    const nextArchivedSlot = computeStartSlotAtEpoch(100);
    await db.stateArchive.putBinary(lastArchivedSlot, new Uint8Array([1]));
    await pruneHistory(config, db, testLogger(), null, 98, 100);
    await db.stateArchive.putBinary(nextArchivedSlot, new Uint8Array([2]));
    const keys = vi.spyOn(db.stateArchive, "keys");

    await pruneHistory(config, db, testLogger(), null, 102, 104, lastArchivedSlot);

    expect(keys.mock.calls.filter(([opts]) => opts?.gte !== undefined)).toEqual([
      [{gte: lastArchivedSlot, lt: nextArchivedSlot}],
    ]);
    expect(await db.stateArchive.keys()).toEqual([nextArchivedSlot]);
  });

  it("skips the state scan when the archive is empty", async () => {
    const keys = vi.spyOn(db.stateArchive, "keys");

    await pruneHistory(config, db, testLogger(), null, 98, 100);

    expect(keys.mock.calls.filter(([opts]) => opts?.gte !== undefined)).toEqual([]);
  });

  it("scans from zero on startup even after earlier pruning", async () => {
    const lastArchivedSlot = computeStartSlotAtEpoch(90);
    await db.stateArchive.putBinary(lastArchivedSlot, new Uint8Array([1]));
    await pruneHistory(config, db, testLogger(), null, 98, 100);
    await db.stateArchive.putBinary(0, new Uint8Array([2]));

    await pruneHistory(config, db, testLogger(), null, 99, 101);

    expect(await db.stateArchive.keys()).toEqual([lastArchivedSlot]);
  });
});
