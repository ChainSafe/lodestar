import {CheckpointWithHex} from "@lodestar/fork-choice";
import {LoggerNode} from "@lodestar/logger/node";
import {ForkSeq} from "@lodestar/params";
import {Checkpoint} from "@lodestar/types/phase0";
import {callFnWhenAwait} from "@lodestar/utils";
import {IBeaconDb} from "../../db/index.js";
import {Metrics} from "../../metrics/metrics.js";
import {isOptimisticBlock} from "../../util/forkChoice.js";
import {JobItemQueue, isQueueErrorAborted} from "../../util/queue/index.js";
import {ChainEvent} from "../emitter.js";
import {IBeaconChain} from "../interface.js";
import {PROCESS_FINALIZED_CHECKPOINT_QUEUE_LENGTH} from "./constants.js";
import {HistoricalStateRegen} from "./historicalState/historicalStateRegen.js";
import {ArchiveMode, ArchiveStoreOpts, StateArchiveStrategy} from "./interface.js";
import {FrequencyStateArchiveStrategy} from "./strategies/frequencyStateArchiveStrategy.js";
import {archiveBlocks} from "./utils/archiveBlocks.js";
import {pruneHistory} from "./utils/pruneHistory.js";
import {updateBackfillRange} from "./utils/updateBackfillRange.js";

type ArchiveStoreModules = {
  chain: IBeaconChain;
  db: IBeaconDb;
  logger: LoggerNode;
  metrics: Metrics | null;
};

type ArchiveStoreInitOpts = ArchiveStoreOpts & {dbName: string; anchorState: {finalizedCheckpoint: Checkpoint}};

export enum ArchiveStoreTask {
  ArchiveBlocks = "archive_blocks",
  PruneHistory = "prune_history",
  OnFinalizedCheckpoint = "on_finalized_checkpoint",
  MaybeArchiveState = "maybe_archive_state",
  RegenPruneOnFinalized = "regen_prune_on_finalized",
  ForkchoicePrune = "forkchoice_prune",
  UpdateBackfillRange = "update_backfill_range",
}

/**
 * Used for running tasks that depends on some events or are executed
 * periodically.
 */
export class ArchiveStore {
  private archiveMode: ArchiveMode;
  private jobQueue: JobItemQueue<[CheckpointWithHex], void>;

  private archiveDataEpochs?: number;
  private readonly statesArchiverStrategy: StateArchiveStrategy;
  private readonly chain: IBeaconChain;
  private readonly db: IBeaconDb;
  private readonly logger: LoggerNode;
  private readonly metrics: Metrics | null;
  private readonly opts: ArchiveStoreInitOpts;
  private readonly signal: AbortSignal;

  private historicalStateRegen?: HistoricalStateRegen;

  constructor(modules: ArchiveStoreModules, opts: ArchiveStoreInitOpts, signal: AbortSignal) {
    this.chain = modules.chain;
    this.db = modules.db;
    this.logger = modules.logger;
    this.metrics = modules.metrics;
    this.opts = opts;
    this.signal = signal;
    this.archiveMode = opts.archiveMode;
    this.archiveDataEpochs = opts.archiveDataEpochs;

    this.jobQueue = new JobItemQueue<[CheckpointWithHex], void>(this.processFinalizedCheckpoint, {
      maxLength: PROCESS_FINALIZED_CHECKPOINT_QUEUE_LENGTH,
      signal,
    });

    if (opts.archiveMode === ArchiveMode.Frequency) {
      this.statesArchiverStrategy = new FrequencyStateArchiveStrategy(
        this.chain.regen,
        this.db,
        this.logger,
        opts,
        this.chain.bufferPool
      );
    } else {
      throw new Error(`State archive strategy "${opts.archiveMode}" currently not supported.`);
    }

    if (!opts.disableArchiveOnCheckpoint) {
      this.chain.emitter.on(ChainEvent.forkChoiceFinalized, this.onFinalizedCheckpoint);
      this.chain.emitter.on(ChainEvent.checkpoint, this.onCheckpoint);

      this.signal.addEventListener(
        "abort",
        () => {
          this.chain.emitter.off(ChainEvent.forkChoiceFinalized, this.onFinalizedCheckpoint);
          this.chain.emitter.off(ChainEvent.checkpoint, this.onCheckpoint);
        },
        {once: true}
      );
    }
  }

  async init(): Promise<void> {
    if (this.opts.pruneHistory) {
      // prune ALL stale data before starting
      this.logger.info("Pruning historical data");
      await callFnWhenAwait(
        pruneHistory(
          this.chain.config,
          this.db,
          this.logger,
          this.metrics,
          this.opts.anchorState.finalizedCheckpoint.epoch,
          this.chain.clock.currentEpoch
        ),
        () => this.logger.info("Still pruning historical data, please wait..."),
        30_000,
        this.signal
      );
    }

    if (this.opts.serveHistoricalState) {
      this.historicalStateRegen = await HistoricalStateRegen.init({
        opts: {
          genesisTime: this.chain.clock.genesisTime,
          dbLocation: this.opts.dbName,
        },
        config: this.chain.config,
        metrics: this.metrics,
        logger: this.logger,
        signal: this.signal,
      });
    }
  }

  async close(): Promise<void> {
    await this.historicalStateRegen?.close();
  }

  async scrapeMetrics(): Promise<string> {
    return this.historicalStateRegen?.scrapeMetrics() ?? "";
  }

  async getHistoricalStateBySlot(
    slot: number
  ): Promise<{state: Uint8Array; executionOptimistic: boolean; finalized: boolean} | null> {
    const finalizedBlock = this.chain.forkChoice.getFinalizedBlock();

    if (slot >= finalizedBlock.slot) {
      return null;
    }

    // request for finalized state using historical state regen
    const stateSerialized = await this.historicalStateRegen?.getHistoricalState(slot);
    if (!stateSerialized) {
      return null;
    }

    return {state: stateSerialized, executionOptimistic: isOptimisticBlock(finalizedBlock), finalized: true};
  }

  /**
   * Archive latest finalized state
   * */
  async persistToDisk(): Promise<void> {
    return this.statesArchiverStrategy.archiveState(this.chain.forkChoice.getFinalizedCheckpoint());
  }

  //-------------------------------------------------------------------------
  // Event handlers
  //-------------------------------------------------------------------------
  private onFinalizedCheckpoint = (finalized: CheckpointWithHex): void => {
    this.jobQueue.push(finalized).catch((e) => {
      if (!isQueueErrorAborted(e)) {
        this.logger.error("Error queuing finalized checkpoint", {epoch: finalized.epoch}, e as Error);
      }
    });
  };

  private onCheckpoint = (): void => {
    const headStateRoot = this.chain.forkChoice.getHead().stateRoot;
    this.chain.regen.pruneOnCheckpoint(
      this.chain.forkChoice.getFinalizedCheckpoint().epoch,
      this.chain.forkChoice.getJustifiedCheckpoint().epoch,
      headStateRoot
    );

    this.statesArchiverStrategy.onCheckpoint(headStateRoot, this.metrics).catch((err) => {
      this.logger.error("Error during state archive", {archiveMode: this.archiveMode}, err);
    });
  };

  private processFinalizedCheckpoint = async (finalized: CheckpointWithHex): Promise<void> => {
    try {
      const finalizedEpoch = finalized.epoch;
      this.logger.verbose("Start processing finalized checkpoint", {epoch: finalizedEpoch, rootHex: finalized.rootHex});

      let timer = this.metrics?.processFinalizedCheckpoint.durationByTask.startTimer();
      await archiveBlocks(
        this.chain.config,
        this.db,
        this.chain.forkChoice,
        this.chain.lightClientServer,
        this.logger,
        finalized,
        this.chain.clock.currentEpoch,
        this.archiveDataEpochs,
        this.chain.opts.persistOrphanedBlocks,
        this.chain.opts.persistOrphanedBlocksDir
      );
      timer?.({source: ArchiveStoreTask.ArchiveBlocks});

      // Archive execution payload envelopes for Gloas blocks
      await this.archiveExecutionPayloadEnvelopes(finalized);

      if (this.opts.pruneHistory) {
        timer = this.metrics?.processFinalizedCheckpoint.durationByTask.startTimer();
        await pruneHistory(
          this.chain.config,
          this.db,
          this.logger,
          this.metrics,
          finalizedEpoch,
          this.chain.clock.currentEpoch
        );
        timer?.({source: ArchiveStoreTask.PruneHistory});
      }

      timer = this.metrics?.processFinalizedCheckpoint.durationByTask.startTimer();
      await this.statesArchiverStrategy.onFinalizedCheckpoint(finalized, this.metrics);
      timer?.({source: ArchiveStoreTask.OnFinalizedCheckpoint});

      // should be after ArchiveBlocksTask to handle restart cleanly
      timer = this.metrics?.processFinalizedCheckpoint.durationByTask.startTimer();
      await this.statesArchiverStrategy.maybeArchiveState(finalized, this.metrics);
      timer?.({source: ArchiveStoreTask.MaybeArchiveState});

      timer = this.metrics?.processFinalizedCheckpoint.durationByTask.startTimer();
      this.chain.regen.pruneOnFinalized(finalizedEpoch);
      timer?.({source: ArchiveStoreTask.RegenPruneOnFinalized});

      // tasks rely on extended fork choice
      timer = this.metrics?.processFinalizedCheckpoint.durationByTask.startTimer();
      const prunedBlocks = this.chain.forkChoice.prune(finalized.rootHex);
      timer?.({source: ArchiveStoreTask.ForkchoicePrune});

      timer = this.metrics?.processFinalizedCheckpoint.durationByTask.startTimer();
      await updateBackfillRange({chain: this.chain, db: this.db, logger: this.logger}, finalized);
      timer?.({source: ArchiveStoreTask.UpdateBackfillRange});

      this.logger.verbose("Finish processing finalized checkpoint", {
        epoch: finalizedEpoch,
        rootHex: finalized.rootHex,
        prunedBlocks: prunedBlocks.length,
      });
    } catch (e) {
      if (!this.signal.aborted) {
        this.logger.error("Error processing finalized checkpoint", {epoch: finalized.epoch}, e as Error);
      }
    }
  };

  /**
   * Move execution payload envelopes from hot storage to archive storage.
   * Only processes Gloas blocks (fork >= gloas).
   *
   * CRITICAL: Only archive payloads for blocks where FULL variant is canonical.
   * If EMPTY variant is canonical (builder didn't reveal), DISCARD the payload.
   */
  private async archiveExecutionPayloadEnvelopes(finalized: CheckpointWithHex): Promise<void> {
    // Get finalized block
    const finalizedBlock = this.chain.forkChoice.getFinalizedBlock();
    if (!finalizedBlock) return;

    // Check if Gloas fork is active
    const finalizedSlot = finalizedBlock.slot;
    const forkSeq = this.chain.config.getForkSeq(finalizedSlot);
    if (forkSeq < ForkSeq.gloas) {
      // Pre-Gloas blocks don't have separate payload envelopes
      return;
    }

    // TODO: Iterate through finalized blocks and process their payload envelopes
    // This requires iterating from last archived slot to finalized slot
    //
    // For each Gloas block:
    //   1. Check fork choice to get canonical variant (via getBlock and check payload status)
    //   2. If FULL variant is canonical:
    //      - Move envelope from hot to archive storage
    //   3. If EMPTY variant is canonical:
    //      - DISCARD the envelope (delete from hot storage, don't archive)
    //      - This happens when builder didn't reveal payload
    //
    // Example logic:
    // for (let slot = lastArchivedSlot + 1; slot <= finalizedSlot; slot++) {
    //   // Get block at this slot from fork choice
    //   const blockRoot = await db.blockArchive.getBySlot(slot);
    //   if (!blockRoot) continue;
    //   const blockRootHex = toHex(blockRoot);
    //
    //   // Check if block exists in fork choice
    //   // NOTE: Using hasBlock (signature unchanged between unstable and nc/epbs-fc)
    //   if (!chain.forkChoice.hasBlock(blockRootHex)) continue;
    //
    //   // NOTE: On nc/epbs-fc, to get the canonical payload status:
    //   //   Use getBlockHexDefaultStatus(blockRoot) to get the default (canonical) variant
    //   //   Or use getParentPayloadStatus() helper if available
    //   //   Or check ProtoBlock's payloadStatus field directly
    //   //
    //   // For now on unstable, we need to determine payload status differently:
    //   // - Check if payload envelope exists in hot DB
    //   // - If exists and block is Gloas, it's FULL variant (we have the payload)
    //   // - Otherwise it's EMPTY variant (payload not revealed)
    //
    //   const forkSeq = chain.config.getForkSeq(slot);
    //   if (forkSeq < ForkSeq.gloas) {
    //     // Pre-Gloas blocks don't have payloads, skip
    //     continue;
    //   }
    //
    //   // Determine payload status (on unstable branch)
    //   // TODO: When merging with nc/epbs-fc, use fork choice API to get canonical payload status
    //   const envelope = await db.executionPayloadEnvelope.get(blockRoot);
    //   const hasPayload = envelope !== null;
    //
    //   if (hasPayload) {
    //     // FULL variant - move to archive
    //     await db.executionPayloadEnvelopeArchive.put(slot, envelope);
    //     await db.executionPayloadEnvelope.delete(blockRoot);
    //   } else {
    //     // EMPTY variant - nothing to archive or discard
    //     // (payload never existed or was already discarded)
    //   }
    // }
  }
}
