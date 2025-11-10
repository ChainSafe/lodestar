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
    const finalizedBlockFC = chain.forkChoice.getBlockHex(finalized.rootHex);
    const previousBackfillRange = await db.backfillRange.get();

    const finalizedPostDeneb = finalized.epoch >= chain.config.DENEB_FORK_EPOCH;
    const finalizedPostFulu = finalized.epoch >= chain.config.FULU_FORK_EPOCH;

    if (
      finalizedBlockFC &&
      (finalizedBlockFC.slot > chain.anchorStateLatestBlockSlot ||
        (previousBackfillRange && finalizedBlockFC.slot > previousBackfillRange?.endingEpoch * SLOTS_PER_EPOCH))
    ) {
      await db.backfillRange.put({
        beginningEpoch: computeEpochAtSlot(finalizedBlockFC.slot),
        endingEpoch: previousBackfillRange?.endingEpoch || computeEpochAtSlot(chain.anchorStateLatestBlockSlot),
      });
      // DEBUG_CODE
      logger.info("Updated backfillRange while migrating from hot to cold db", {
        beginningEpoch: computeEpochAtSlot(finalizedBlockFC.slot),
        endingEpoch: previousBackfillRange?.endingEpoch || computeEpochAtSlot(chain.anchorStateLatestBlockSlot),
        previousBackfillRangeBeginningEpoch: previousBackfillRange?.beginningEpoch,
        previousBackfillRangeEndingEpoch: previousBackfillRange?.endingEpoch,
        chainAnchorStateLatestBlockSlotEpoch: computeEpochAtSlot(chain.anchorStateLatestBlockSlot),
      });
      // DEBUG_CODE

      // const custodyColumns = chain.custodyConfig.custodyColumns;
      await db.backfillState.put(finalized.epoch, {
        hasBlock: true,
        // check if blobs & columns are filled in live chain
        hasBlobs: finalizedPostDeneb ? true : null,
        columnIndices: finalizedPostFulu ? [] : null,
      });

      // DEBUG_CODE
      logger.info("Updated backfillState while migrating from hot to cold db", {
        finalizedEpoch: finalized.epoch,
        hasBlock: true,
        hasBlobs: finalizedPostDeneb ? true : null,
        columnIndices: finalizedPostFulu ? prettyPrintIndices([]) : null,
      });
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
    }
  } catch (e) {
    logger.error("Error updating backfilledRanges on finalization", {epoch: finalized.epoch}, e as Error);
  }
}
