import {Key} from "interface-datastore";
import {KeyValue} from "@lodestar/db";
import {CheckpointWithHex} from "@lodestar/fork-choice";
import {Logger} from "@lodestar/logger";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {prettyPrintIndices} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/interface.js";
import {BackfillState, EpochBackfillState} from "../../../db/repositories/backfillState.ts";
import {IBeaconChain} from "../../interface.js";

// Todo: Update comments wrt BackfillRange
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
    // const {ancestors: finalizedCanonicalBlocks, nonAncestors: finalizedNonCanonicalBlocks} =
    //   chain.forkChoice.getAllAncestorAndNonAncestorBlocks(finalized.rootHex);

    // Mark the sequence in backfill db from finalized block's slot till anchor slot as
    // filled.
    const finalizedBlockFC = chain.forkChoice.getBlock(finalized.root);
    const previousBackfillRange = await db.backfillRange.get();

    const finalizedPostDeneb = finalized.epoch >= chain.config.DENEB_FORK_EPOCH;
    const finalizedPostFulu = finalized.epoch >= chain.config.FULU_FORK_EPOCH;

    if (!finalizedBlockFC) {
      logger.error("finalizedBlockFC not present");
      throw new Error("finalizedBlockFC not present");
    }

    /**
     * Update with the epoch whose blocks were actually downloaded and stored in blockArchive.
     * These blocks are the ones prior to and including the finalized slot
     * (i.e., the first slot of the finalized epoch).
     */

    if (previousBackfillRange) {
      // Todo: Also think about it when blocks of more than 1 epoch are archived
      const newBeginningEpoch = computeEpochAtSlot(finalizedBlockFC.slot - 1);
      const newBackfillRange = {
        beginningEpoch:
          newBeginningEpoch > previousBackfillRange.beginningEpoch
            ? newBeginningEpoch
            : previousBackfillRange.beginningEpoch,
        endingEpoch: previousBackfillRange.endingEpoch,
      };
      const newBackfillStateEpoch = computeEpochAtSlot(finalizedBlockFC.slot - 1);
      const newBackfillState = {
        hasBlock: true,
        // check if blobs & columns are filled in live chain
        hasBlobs: finalizedPostDeneb ? true : null,
        columnIndices: finalizedPostFulu ? [] : null,
      };

      await db.backfillRange.put(newBackfillRange);
      await db.backfillState.put(newBackfillStateEpoch, newBackfillState);

      logger.verbose("Updated backfillState while migrating from hot to cold db", {
        finalizedEpoch: finalized.epoch,
        hasBlock: true,
        hasBlobs: finalizedPostDeneb ? true : null,
        columnIndices: finalizedPostFulu ? prettyPrintIndices([]) : null,
        backfillRangeBeginningEpoch: newBackfillRange.beginningEpoch,
        backfillStateEpoch: newBackfillStateEpoch,
      });
    }
    // most probably this wont be hitted
    else {
      /**
       * We initialize this only when `finalizedBlockFC.slot`
       * is exactly one epoch ahead of `anchorStateLatestBlockSlot`.
       * This guarantees that all blocks from the epoch preceding the finalized epoch
       * have already been migrated to the blockArchive DB.
       */
      if (finalizedBlockFC.slot > chain.anchorStateLatestBlockSlot) {
        const initEpoch = computeEpochAtSlot(finalizedBlockFC.slot - 1);
        const initBackfillRange = {
          beginningEpoch: initEpoch,
          endingEpoch: initEpoch,
        };
        const initBackfillState = {
          hasBlock: true,
          // check if blobs & columns are filled in live chain
          hasBlobs: finalizedPostDeneb ? true : null,
          columnIndices: finalizedPostFulu ? [] : null,
        };

        await db.backfillRange.put(initBackfillRange);
        await db.backfillState.put(initEpoch, initBackfillState);

        logger.verbose("Initialized backfillState while migrating from hot to cold db", {
          finalizedEpoch: finalized.epoch,
          initEpoch,
        });
      } else {
        logger.debug(
          "Skipped initialization of backfillState while migrating from hot to cold db (slot not ahead of anchor)",
          {
            finalizedBlockSlot: finalizedBlockFC.slot,
            anchorStateLatestBlockSlot: chain.anchorStateLatestBlockSlot,
          }
        );
      }
    }
    // DEBUG_CODE

    // Todo: verify if this function runs every epoch, else intermediate epoch backfill states will be empty.
    // Below could be a possible solution to this issue.

    // // In case of long unfinality, this needs to be done to save multiple epochs
    // // First, find all *unique* epochs from the list of finalized blocks
    // const uniqueEpochs = Array.from(new Set(finalizedCanonicalBlocks.map((block) => block.finalizedEpoch)));
    // const backfillStates: KeyValue<number, EpochBackfillState>[] = uniqueEpochs.map((epoch) => {
    //   return {
    //     key: epoch,
    //     value: {
    //       hasBlock: true,
    //       // check if blobs & columns are filled in live chain
    //       hasBlobs: finalizedPostDeneb ? true : null,
    //       columnIndices: finalizedPostFulu ? [] : null,
    //     },
    //   };
    // });
    // await db.backfillState.batchPut(backfillStates);
  } catch (e) {
    logger.error("Error updating backfilledRanges on finalization", {epoch: finalized.epoch}, e as Error);
  }
}
