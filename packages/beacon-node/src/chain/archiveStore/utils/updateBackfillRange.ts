import {CheckpointWithHex} from "@lodestar/fork-choice";
import {Logger} from "@lodestar/logger";
import {IBeaconDb} from "../../../db/interface.js";
import {IBeaconChain} from "../../interface.js";

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
  {chain, db, logger}: {chain: IBeaconChain; db: IBeaconDb; logger: Logger},
  finalized: CheckpointWithHex
): Promise<void> {
  try {
    // Mark the sequence in backfill db from finalized block's slot till anchor slot as
    // filled.
    const finalizedBlockFC = chain.forkChoice.getBlockHex(finalized.rootHex);
    if (finalizedBlockFC && finalizedBlockFC.slot > chain.anchorStateLatestBlockSlot) {
      await db.backfilledRanges.put(finalizedBlockFC.slot, chain.anchorStateLatestBlockSlot);

      // Clear previously marked sequence till anchorStateLatestBlockSlot, without
      // touching backfill sync process sequence which are at
      // <=anchorStateLatestBlockSlot i.e. clear >anchorStateLatestBlockSlot
      // and < currentSlot
      const filteredSeqs = await db.backfilledRanges.entries({
        gt: chain.anchorStateLatestBlockSlot,
        lt: finalizedBlockFC.slot,
      });
      logger.debug("updated backfilledRanges", {
        key: finalizedBlockFC.slot,
        value: chain.anchorStateLatestBlockSlot,
      });
      if (filteredSeqs.length > 0) {
        await db.backfilledRanges.batchDelete(filteredSeqs.map((entry) => entry.key));
        logger.debug(
          `Forward Sync - cleaned up backfilledRanges between ${finalizedBlockFC.slot},${chain.anchorStateLatestBlockSlot}`,
          {seqs: JSON.stringify(filteredSeqs)}
        );
      }
    }
  } catch (e) {
    logger.error("Error updating backfilledRanges on finalization", {epoch: finalized.epoch}, e as Error);
  }
}
