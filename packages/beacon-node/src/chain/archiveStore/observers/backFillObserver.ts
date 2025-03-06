import {CheckpointWithHex} from "@lodestar/fork-choice";
import {Logger} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/interface.js";
import { QueueObserver } from "../../observer.js";
import {IBeaconChain} from "../../interface.js";
import {PROCESS_FINALIZED_CHECKPOINT_QUEUE_LEN} from "../constants.js";

export class BackFillObserver extends QueueObserver {
  constructor(
    protected modules: {logger: Logger; chain: IBeaconChain; db: IBeaconDb},
    {signal}: {signal: AbortSignal}
  ) {
    super({logger: modules.logger, maxQueueLength: PROCESS_FINALIZED_CHECKPOINT_QUEUE_LEN, signal});
  }

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
  async onForkChoiceFinalized(finalized: CheckpointWithHex): Promise<void> {
    try {
      // Mark the sequence in backfill db from finalized block's slot till anchor slot as
      // filled.
      const finalizedBlockFC = this.modules.chain.forkChoice.getBlockHex(finalized.rootHex);
      if (finalizedBlockFC && finalizedBlockFC.slot > this.modules.chain.anchorStateLatestBlockSlot) {
        await this.modules.db.backfilledRanges.put(
          finalizedBlockFC.slot,
          this.modules.chain.anchorStateLatestBlockSlot
        );

        // Clear previously marked sequence till anchorStateLatestBlockSlot, without
        // touching backfill sync process sequence which are at
        // <=anchorStateLatestBlockSlot i.e. clear >anchorStateLatestBlockSlot
        // and < currentSlot
        const filteredSeqs = await this.modules.db.backfilledRanges.entries({
          gt: this.modules.chain.anchorStateLatestBlockSlot,
          lt: finalizedBlockFC.slot,
        });
        this.logger.debug("updated backfilledRanges", {
          key: finalizedBlockFC.slot,
          value: this.modules.chain.anchorStateLatestBlockSlot,
        });
        if (filteredSeqs.length > 0) {
          await this.modules.db.backfilledRanges.batchDelete(filteredSeqs.map((entry) => entry.key));
          this.logger.debug(
            `Forward Sync - cleaned up backfilledRanges between ${finalizedBlockFC.slot},${this.modules.chain.anchorStateLatestBlockSlot}`,
            {seqs: JSON.stringify(filteredSeqs)}
          );
        }
      }
    } catch (e) {
      this.logger.error("Error updating backfilledRanges on finalization", {epoch: finalized.epoch}, e as Error);
    }
  }
}
