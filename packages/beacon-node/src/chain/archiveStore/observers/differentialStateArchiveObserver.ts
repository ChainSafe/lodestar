import {BeaconConfig} from "@lodestar/config";
import {CheckpointWithHex, IForkChoice} from "@lodestar/fork-choice";
import {CachedBeaconStateAllForks, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Slot} from "@lodestar/types";
import {Checkpoint} from "@lodestar/types/lib/phase0/types.js";
import {Logger} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/index.js";
import {LodestarQueueObserver} from "../../../interface.js";
import {Metrics} from "../../../metrics/metrics.js";
import {IClock} from "../../../util/clock.js";
import {ChainEvent, ChainEventEmitter} from "../../emitter.js";
import {LightClientServer} from "../../lightClient/index.js";
import {IStateRegenerator} from "../../regen/interface.js";
import {PROCESS_FINALIZED_CHECKPOINT_QUEUE_LEN} from "../constants.js";
import {ArchiveMode, ArchiveStoreOpts, HistoricalStateServiceApi} from "../interface.js";

export class DifferentialStateArchiveObserver extends LodestarQueueObserver<[CheckpointWithHex], void> {
  private prevFinalized: CheckpointWithHex;
  private archiveBlobEpochs?: number;

  constructor(
    private readonly modules: {
      logger: Logger;
      db: IBeaconDb;
      config: BeaconConfig;
      forkChoice: IForkChoice;
      lightClientServer?: LightClientServer;
      clock: IClock;
      regen: IStateRegenerator;
      getAnchorStateLatestBlockSlot: () => Slot;
      metrics: Metrics | null;
      historicalStateService?: HistoricalStateServiceApi;
    },
    private opts: ArchiveStoreOpts,
    signal: AbortSignal
  ) {
    super({maxQueueLength: PROCESS_FINALIZED_CHECKPOINT_QUEUE_LEN, signal, metrics: modules.metrics});
    this.archiveBlobEpochs = opts.archiveBlobEpochs;
    this.prevFinalized = modules.forkChoice.getFinalizedCheckpoint();

    if (opts.archiveMode !== ArchiveMode.Differential) {
      throw new Error(
        "DifferentialStateArchiveObserver is only meant to use when archiveMode is ArchiveMode.Differential"
      );
    }
  }

  subscribe(emitter: ChainEventEmitter): void {
    if (this.opts.disableArchiveOnCheckpoint) return;

    emitter.on(ChainEvent.forkChoiceFinalized, this.onForkChoiceFinalized.bind(this));
  }

  unsubscribe(emitter: ChainEventEmitter): void {
    emitter.off(ChainEvent.forkChoiceFinalized, this.onForkChoiceFinalized);
  }

  private async onForkChoiceFinalized(checkpoint: CheckpointWithHex): Promise<void> {
    this.processLater(checkpoint);
  }

  protected async processQueueItem(finalized: CheckpointWithHex): Promise<void> {
    try {
      const finalizedEpoch = finalized.epoch;
      this.modules.logger.verbose("Start processing finalized checkpoint", {
        epoch: finalizedEpoch,
        rootHex: finalized.rootHex,
      });
      this.prevFinalized = finalized;

      // starting from Mar 2024, the finalized state could be from disk or in memory
      const state = await this.modules.regen.getCheckpointStateOrBytes(finalized);
      if (state === null) {
        this.modules.logger.warn("Checkpoint state not available to archive.", {
          epoch: finalized.epoch,
          root: finalized.rootHex,
        });
        return;
      }

      if (Array.isArray(state) && state.constructor === Uint8Array) {
        return this.modules.historicalStateService?.storeHistoricalState(
          computeStartSlotAtEpoch(finalized.epoch),
          state
        );
      }

      await this.modules.historicalStateService?.storeHistoricalState(
        (state as CachedBeaconStateAllForks).slot,
        (state as CachedBeaconStateAllForks).serialize()
      );

      this.modules.regen.pruneOnFinalized(finalizedEpoch);

      // tasks rely on extended fork choice
      const prunedBlocks = this.modules.forkChoice.prune(finalized.rootHex);
      await this.updateBackfillRange(finalized);

      this.modules.logger.verbose("Finish processing finalized checkpoint", {
        epoch: finalizedEpoch,
        rootHex: finalized.rootHex,
        prunedBlocks: prunedBlocks.length,
      });
    } catch (e) {
      this.modules.logger.error("Error processing finalized checkpoint", {epoch: finalized.epoch}, e as Error);
    }
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
  private updateBackfillRange = async (finalized: CheckpointWithHex): Promise<void> => {
    try {
      // Mark the sequence in backfill db from finalized block's slot till anchor slot as
      // filled.
      const finalizedBlockFC = this.modules.forkChoice.getBlockHex(finalized.rootHex);
      const anchorStateLatestBlockSlot = this.modules.getAnchorStateLatestBlockSlot();

      if (finalizedBlockFC && finalizedBlockFC.slot > anchorStateLatestBlockSlot) {
        await this.modules.db.backfilledRanges.put(finalizedBlockFC.slot, anchorStateLatestBlockSlot);

        // Clear previously marked sequence till anchorStateLatestBlockSlot, without
        // touching backfill sync process sequence which are at
        // <=anchorStateLatestBlockSlot i.e. clear >anchorStateLatestBlockSlot
        // and < currentSlot
        const filteredSeqs = await this.modules.db.backfilledRanges.entries({
          gt: this.modules.getAnchorStateLatestBlockSlot(),
          lt: finalizedBlockFC.slot,
        });
        this.modules.logger.debug("updated backfilledRanges", {
          key: finalizedBlockFC.slot,
          value: anchorStateLatestBlockSlot,
        });
        if (filteredSeqs.length > 0) {
          await this.modules.db.backfilledRanges.batchDelete(filteredSeqs.map((entry) => entry.key));
          this.modules.logger.debug(
            `Forward Sync - cleaned up backfilledRanges between ${finalizedBlockFC.slot},${anchorStateLatestBlockSlot}`,
            {seqs: JSON.stringify(filteredSeqs)}
          );
        }
      }
    } catch (e) {
      this.modules.logger.error(
        "Error updating backfilledRanges on finalization",
        {epoch: finalized.epoch},
        e as Error
      );
    }
  };
}
