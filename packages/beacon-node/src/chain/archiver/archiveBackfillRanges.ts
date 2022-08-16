import {CheckpointWithHex, ProtoBlock} from "@lodestar/fork-choice";
import {Slot} from "@lodestar/types";
import {ILogger} from "@lodestar/utils";
import {IBeaconDb} from "../../db/index.js";

/**
 * Backfill sync relies on verified connected ranges (which are represented as key,value
 * with a verified jump from a key back to value). Since the node could have progressed
 * ahead from, we need to save the forward progress of this node as another backfill
 * range entry, that backfill sync will use to jump back if this node is restarted
 * for any reason.
 * The current backfill has its own backfill entry from anchor slot to last backfilled
 * slot. And this would create the entry from the current finalized slot to the anchor
 * slot.
 */
export async function updateBackfillRange(
  {db, logger}: {db: IBeaconDb; logger: ILogger},
  finalizedBlock: ProtoBlock,
  finalized: CheckpointWithHex,
  anchorStateLatestBlockSlot: Slot
): Promise<void> {
  try {
    // Mark the sequence in backfill db from finalized block's slot till anchor slot as filled.
    if (finalizedBlock.slot <= anchorStateLatestBlockSlot) {
      return;
    }

    await db.backfilledRanges.put(finalizedBlock.slot, anchorStateLatestBlockSlot);

    // Clear previously marked sequence till anchorStateLatestBlockSlot, without
    // touching backfill sync process sequence which are at
    // <=anchorStateLatestBlockSlot i.e. clear >anchorStateLatestBlockSlot
    // and < currentSlot
    const filteredSeqs = await db.backfilledRanges.entries({
      gt: anchorStateLatestBlockSlot,
      lt: finalizedBlock.slot,
    });

    logger.debug("updated backfilledRanges", {
      key: finalizedBlock.slot,
      value: anchorStateLatestBlockSlot,
    });

    if (filteredSeqs.length > 0) {
      await db.backfilledRanges.batchDelete(filteredSeqs.map((entry) => entry.key));
      logger.debug(
        `Forward Sync - cleaned up backfilledRanges between ${finalizedBlock.slot},${anchorStateLatestBlockSlot}`,
        {seqs: JSON.stringify(filteredSeqs)}
      );
    }
  } catch (e) {
    logger.error("Error updating backfilledRanges on finalization", {epoch: finalized.epoch}, e as Error);
  }
}
