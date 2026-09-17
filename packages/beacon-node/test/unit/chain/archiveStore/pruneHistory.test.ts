import {afterEach, beforeEach, describe, expect, it} from "vitest";
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
});
