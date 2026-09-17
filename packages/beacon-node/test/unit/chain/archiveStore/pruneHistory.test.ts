import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {testLogger} from "@lodestar/logger/test-utils";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {pruneHistory} from "../../../../src/chain/archiveStore/utils/pruneHistory.js";
import {BeaconDb} from "../../../../src/db/index.js";
import {startTmpBeaconDb} from "../../../utils/db.js";

describe("chain / archiveStore / pruneHistory", () => {
  let db: BeaconDb;

  beforeEach(async () => {
    db = await startTmpBeaconDb(config);
  });

  afterEach(async () => {
    await db.close();
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
    await db.executionPayloadEnvelopeArchive.batchPut(
      slots.map((slot) => {
        const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
        envelope.message.payload.slotNumber = slot;
        return {key: slot, value: envelope};
      })
    );

    await pruneHistory(config, db, testLogger(), null, finalizedEpoch, currentEpoch);

    expect(await db.blockArchive.keys()).toEqual([cutoffSlot, cutoffSlot + 100]);
    expect(await db.executionPayloadEnvelopeArchive.keys()).toEqual([cutoffSlot, cutoffSlot + 100]);
  });

  it("prunes blocks older than the reduced retention window post-gloas", async () => {
    const gloasConfig = createChainForkConfig({...config, GLOAS_FORK_EPOCH: 0});
    const minEpochsForBlockRequests = gloasConfig.getMinEpochsForBlockRequests(0);
    expect(minEpochsForBlockRequests).toBeLessThan(config.MIN_EPOCHS_FOR_BLOCK_REQUESTS);

    const currentEpoch = config.MIN_EPOCHS_FOR_BLOCK_REQUESTS + 10;
    const finalizedEpoch = currentEpoch - 2;
    const cutoffSlot = computeStartSlotAtEpoch(currentEpoch - minEpochsForBlockRequests);
    const slots = [0, cutoffSlot - 1, cutoffSlot];

    await db.blockArchive.batchPut(
      slots.map((slot) => {
        const block = ssz.phase0.SignedBeaconBlock.defaultValue();
        block.message.slot = slot;
        return {key: slot, value: block};
      })
    );

    await pruneHistory(gloasConfig, db, testLogger(), null, finalizedEpoch, currentEpoch);

    expect(await db.blockArchive.keys()).toEqual([cutoffSlot]);
  });

  it("limits the blocks pruned per run", async () => {
    const currentEpoch = config.MIN_EPOCHS_FOR_BLOCK_REQUESTS + 10;
    const finalizedEpoch = currentEpoch - 2;
    const maxBlockSlots = 8;
    const firstSlot = 16;
    const slots = [firstSlot, firstSlot + maxBlockSlots - 1, firstSlot + maxBlockSlots, firstSlot + 100];

    await db.blockArchive.batchPut(
      slots.map((slot) => {
        const block = ssz.phase0.SignedBeaconBlock.defaultValue();
        block.message.slot = slot;
        return {key: slot, value: block};
      })
    );

    await pruneHistory(config, db, testLogger(), null, finalizedEpoch, currentEpoch, maxBlockSlots);

    expect(await db.blockArchive.keys()).toEqual([firstSlot + maxBlockSlots, firstSlot + 100]);
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
});
