import {PeerId} from "@libp2p/interface-peer-id";
import {Epoch, Root, Slot, phase0} from "@lodestar/types";
import {ErrorAborted, Logger} from "@lodestar/utils";
import {ChainForkConfig} from "@lodestar/config";
import {toHexString} from "@chainsafe/ssz";
import {BlockInput} from "../../chain/blocks/types.js";
import {PeerAction} from "../../network/index.js";
import {ItTrigger} from "../../util/itTrigger.js";
import {PeerMap} from "../../util/peerMap.js";
import {wrapError} from "../../util/wrapError.js";
import {RangeSyncType} from "../utils/remoteSyncType.js";
import {BATCH_BUFFER_SIZE, EPOCHS_PER_BATCH} from "../constants.js";
import {Batch, BatchError, BatchErrorCode, BatchMetadata, BatchStatus} from "./batch.js";
import {
  validateBatchesStatus,
  getNextBatchToProcess,
  toBeDownloadedStartEpoch,
  toArr,
  ChainPeersBalancer,
  computeMostCommonTarget,
  batchStartEpochIsAfterSlot,
  isSyncChainDone,
  getBatchSlotRange,
} from "./utils/index.js";

export type SyncChainModules = {
  config: ChainForkConfig;
  logger: Logger;
};

export type SyncChainFns = {
  /**
   * Must return if ALL blocks are processed successfully
   * If SOME blocks are processed must throw BlockProcessorError()
   */
  processChainSegment: (blocks: BlockInput[], syncType: RangeSyncType) => Promise<void>;
  /** Must download blocks, and validate their range */
  downloadBeaconBlocksByRange: (peer: PeerId, request: phase0.BeaconBlocksByRangeRequest) => Promise<BlockInput[]>;
  /** Report peer for negative actions. Decouples from the full network instance */
  reportPeer: (peer: PeerId, action: PeerAction, actionName: string) => void;
  /** Hook called when Chain state completes */
  onEnd: (err: Error | null, target: ChainTarget | null) => void;
};

/**
 * Sync this up to this target. Uses slot instead of epoch to re-use logic for finalized sync
 * and head sync. The root is used to uniquely identify this chain on different forks
 */
export type ChainTarget = {
  slot: Slot;
  root: Root;
};

export class SyncChainStartError extends Error {}

export type SyncChainDebugState = {
  targetRoot: string | null;
  targetSlot: number | null;
  syncType: RangeSyncType;
  status: SyncChainStatus;
  startEpoch: number;
  peers: number;
  batches: BatchMetadata[];
};

export enum SyncChainStatus {
  Stopped = "Stopped",
  Syncing = "Syncing",
  Done = "Done",
  Error = "Error",
}

/**
 * Dynamic target sync chain. Peers with multiple targets but with the same syncType are added
 * through the `addPeer()` hook.
 *
 * A chain of blocks that need to be downloaded. Peers who claim to contain the target head
 * root are grouped into the peer pool and queried for batches when downloading the chain.
 */
export class SyncChain {
  /** Short string id to identify this SyncChain in logs */
  readonly logId: string;
  readonly syncType: RangeSyncType;
  /**
   * Should sync up until this slot, then stop.
   * Finalized SyncChains have a dynamic target, so if this chain has no peers the target can become null
   */
  target: ChainTarget;

  /** Number of validated epochs. For the SyncRange to prevent switching chains too fast */
  validatedEpochs = 0;

  readonly firstBatchEpoch: Epoch;
  /**
   * The start of the chain segment. Any epoch previous to this one has been validated.
   * Note: lastEpochWithProcessBlocks` signals the epoch at which 1 or more blocks have been processed
   * successfully. So that epoch itself may or may not be valid.
   */
  private lastEpochWithProcessBlocks: Epoch;
  private status = SyncChainStatus.Stopped;

  private readonly processChainSegment: SyncChainFns["processChainSegment"];
  private readonly downloadBeaconBlocksByRange: SyncChainFns["downloadBeaconBlocksByRange"];
  private readonly reportPeer: SyncChainFns["reportPeer"];
  /** AsyncIterable that guarantees processChainSegment is run only at once at anytime */
  private readonly batchProcessor = new ItTrigger();
  /** Sorted map of batches undergoing some kind of processing. */
  private readonly batches = new Map<Epoch, Batch>();
  private readonly peerset = new PeerMap<ChainTarget>();

  private readonly logger: Logger;
  private readonly config: ChainForkConfig;

  constructor(
    initialBatchEpoch: Epoch,
    initialTarget: ChainTarget,
    syncType: RangeSyncType,
    fns: SyncChainFns,
    modules: SyncChainModules
  ) {
    this.firstBatchEpoch = initialBatchEpoch;
    this.lastEpochWithProcessBlocks = initialBatchEpoch;
    this.target = initialTarget;
    this.syncType = syncType;
    this.processChainSegment = fns.processChainSegment;
    this.downloadBeaconBlocksByRange = fns.downloadBeaconBlocksByRange;
    this.reportPeer = fns.reportPeer;
    this.config = modules.config;
    this.logger = modules.logger;
    this.logId = `${syncType}`;

    // Trigger event on parent class
    this.sync().then(
      () => fns.onEnd(null, this.target),
      (e) => fns.onEnd(e, null)
    );
  }

  /**
   * Start syncing a new chain or an old one with an existing peer list
   * In the same call, advance the chain if localFinalizedEpoch >
   */
  startSyncing(localFinalizedEpoch: Epoch): void {
    switch (this.status) {
      case SyncChainStatus.Stopped:
        break; // Ok, continue
      case SyncChainStatus.Syncing:
        return; // Skip, already started
      case SyncChainStatus.Error:
      case SyncChainStatus.Done:
        throw new SyncChainStartError(`Attempted to start an ended SyncChain ${this.status}`);
    }

    this.status = SyncChainStatus.Syncing;

    this.logger.debug("SyncChain startSyncing", {
      localFinalizedEpoch,
      lastEpochWithProcessBlocks: this.lastEpochWithProcessBlocks,
      targetSlot: this.target.slot,
    });

    // to avoid dropping local progress, we advance the chain with its batch boundaries.
    // get the aligned epoch that produces a batch containing the `localFinalizedEpoch`
    const lastEpochWithProcessBlocksAligned =
      this.lastEpochWithProcessBlocks +
      Math.floor((localFinalizedEpoch - this.lastEpochWithProcessBlocks) / EPOCHS_PER_BATCH) * EPOCHS_PER_BATCH;
    this.advanceChain(lastEpochWithProcessBlocksAligned);

    // Potentially download new batches and process pending
    this.triggerBatchDownloader();
    this.triggerBatchProcessor();
  }

  /**
   * Temporarily stop the chain. Will prevent batches from being processed
   */
  stopSyncing(): void {
    this.status = SyncChainStatus.Stopped;
  }

  /**
   * Permanently remove this chain. Throws the main AsyncIterable
   */
  remove(): void {
    this.batchProcessor.end(new ErrorAborted("SyncChain"));
  }

  /**
   * Add peer to the chain and request batches if active
   */
  addPeer(peer: PeerId, target: ChainTarget): void {
    this.peerset.set(peer, target);
    this.computeTarget();
    this.triggerBatchDownloader();
  }

  /**
   * Returns true if the peer existed and has been removed
   * NOTE: The RangeSync will take care of deleting the SyncChain if peers = 0
   */
  removePeer(peerId: PeerId): boolean {
    const deleted = this.peerset.delete(peerId);
    this.computeTarget();
    return deleted;
  }

  /**
   * Helper to print internal state for debugging when chain gets stuck
   */
  getBatchesState(): BatchMetadata[] {
    return toArr(this.batches).map((batch) => batch.getMetadata());
  }

  get lastValidatedSlot(): Slot {
    // Last epoch of the batch after the last one validated
    return getBatchSlotRange(this.lastEpochWithProcessBlocks + EPOCHS_PER_BATCH).startSlot - 1;
  }

  get isSyncing(): boolean {
    return this.status === SyncChainStatus.Syncing;
  }

  get isRemovable(): boolean {
    return this.status === SyncChainStatus.Error || this.status === SyncChainStatus.Done;
  }

  get peers(): number {
    return this.peerset.size;
  }

  getPeers(): PeerId[] {
    return this.peerset.keys();
  }

  /** Full debug state for lodestar API */
  getDebugState(): SyncChainDebugState {
    return {
      targetRoot: toHexString(this.target.root),
      targetSlot: this.target.slot,
      syncType: this.syncType,
      status: this.status,
      startEpoch: this.lastEpochWithProcessBlocks,
      peers: this.peers,
      batches: this.getBatchesState(),
    };
  }

  private computeTarget(): void {
    if (this.peerset.size > 0) {
      const targets = this.peerset.values();
      this.target = computeMostCommonTarget(targets);
    }
  }

  /**
   * Main Promise that handles the sync process. Will resolve when initial sync completes
   * i.e. when it successfully processes a epoch >= than this chain `targetEpoch`
   */
  private async sync(): Promise<void> {
    try {
      // Start processing batches on demand in strict sequence
      for await (const _ of this.batchProcessor) {
        if (this.status !== SyncChainStatus.Syncing) {
          continue;
        }

        // TODO: Consider running this check less often after the sync is well tested
        validateBatchesStatus(toArr(this.batches));

        // Returns true if SyncChain has processed all possible blocks with slot <= target.slot
        if (isSyncChainDone(toArr(this.batches), this.lastEpochWithProcessBlocks, this.target.slot)) {
          break;
        }

        // Processes the next batch if ready
        const batch = getNextBatchToProcess(toArr(this.batches));
        if (batch) await this.processBatch(batch);
      }

      this.status = SyncChainStatus.Done;
      this.logger.verbose("SyncChain Done", {id: this.logId});
    } catch (e) {
      if (e instanceof ErrorAborted) {
        return; // Ignore
      }

      this.status = SyncChainStatus.Error;
      this.logger.verbose("SyncChain Error", {id: this.logId}, e as Error);

      // If a batch exceeds it's retry limit, maybe downscore peers.
      // shouldDownscoreOnBatchError() functions enforces that all BatchErrorCode values are covered
      if (e instanceof BatchError) {
        const shouldReportPeer = shouldReportPeerOnBatchError(e.type.code);
        if (shouldReportPeer) {
          for (const peer of this.peerset.keys()) {
            this.reportPeer(peer, shouldReportPeer.action, shouldReportPeer.reason);
          }
        }
      }

      throw e;
    }
  }

  /**
   * Request to process batches if possible
   */
  private triggerBatchProcessor(): void {
    this.batchProcessor.trigger();
  }

  /**
   * Request to download batches if possible
   * Backlogs requests into a single pending request
   */
  private triggerBatchDownloader(): void {
    try {
      this.requestBatches(this.peerset.keys());
    } catch (e) {
      // bubble the error up to the main async iterable loop
      this.batchProcessor.end(e as Error);
    }
  }

  /**
   * Attempts to request the next required batches from the peer pool if the chain is syncing.
   * It will exhaust the peer pool and left over batches until the batch buffer is reached.
   */
  private requestBatches(peers: PeerId[]): void {
    if (this.status !== SyncChainStatus.Syncing) {
      return;
    }

    const peerBalancer = new ChainPeersBalancer(peers, toArr(this.batches));

    // Retry download of existing batches
    for (const batch of this.batches.values()) {
      if (batch.state.status !== BatchStatus.AwaitingDownload) {
        continue;
      }

      const peer = peerBalancer.bestPeerToRetryBatch(batch);
      if (peer) {
        void this.sendBatch(batch, peer);
      }
    }

    // find the next pending batch and request it from the peer
    for (const peer of peerBalancer.idlePeers()) {
      const batch = this.includeNextBatch();
      if (!batch) {
        break;
      }
      void this.sendBatch(batch, peer);
    }
  }

  /**
   * Creates the next required batch from the chain. If there are no more batches required, returns `null`.
   */
  private includeNextBatch(): Batch | null {
    const batches = toArr(this.batches);

    // Only request batches up to the buffer size limit
    // Note: Don't count batches in the AwaitingValidation state, to prevent stalling sync
    // if the current processing window is contained in a long range of skip slots.
    const batchesInBuffer = batches.filter((batch) => {
      return batch.state.status === BatchStatus.Downloading || batch.state.status === BatchStatus.AwaitingProcessing;
    });
    if (batchesInBuffer.length > BATCH_BUFFER_SIZE) {
      return null;
    }

    // This line decides the starting epoch of the next batch. MUST ensure no duplicate batch for the same startEpoch
    const startEpoch = toBeDownloadedStartEpoch(batches, this.lastEpochWithProcessBlocks);

    // Don't request batches beyond the target head slot. The to-be-downloaded batch must be strictly after target.slot
    if (batchStartEpochIsAfterSlot(startEpoch, this.target.slot)) {
      return null;
    }

    if (this.batches.has(startEpoch)) {
      this.logger.error("Attempting to add existing Batch to SyncChain", {id: this.logId, startEpoch});
      return null;
    }

    const batch = new Batch(startEpoch, this.config);
    this.batches.set(startEpoch, batch);
    return batch;
  }

  /**
   * Requests the batch assigned to the given id from a given peer.
   */
  private async sendBatch(batch: Batch, peer: PeerId): Promise<void> {
    try {
      batch.startDownloading(peer);

      // wrapError ensures to never call both batch success() and batch error()
      const res = await wrapError(this.downloadBeaconBlocksByRange(peer, batch.request));

      if (!res.err) {
        batch.downloadingSuccess(res.result);
        this.triggerBatchProcessor();
      } else {
        this.logger.verbose("Batch download error", {id: this.logId, ...batch.getMetadata()}, res.err);
        batch.downloadingError(); // Throws after MAX_DOWNLOAD_ATTEMPTS
      }

      // Preemptively request more blocks from peers whilst we process current blocks
      this.triggerBatchDownloader();
    } catch (e) {
      // bubble the error up to the main async iterable loop
      this.batchProcessor.end(e as Error);
    }

    // Preemptively request more blocks from peers whilst we process current blocks
    this.triggerBatchDownloader();
  }

  /**
   * Sends `batch` to the processor. Note: batch may be empty
   */
  private async processBatch(batch: Batch): Promise<void> {
    const blocks = batch.startProcessing();

    // wrapError ensures to never call both batch success() and batch error()
    const res = await wrapError(this.processChainSegment(blocks, this.syncType));

    if (!res.err) {
      batch.processingSuccess();

      // If the processed batch is not empty, validate previous AwaitingValidation blocks.
      if (blocks.length > 0) {
        this.advanceChain(batch.startEpoch);
      }

      // Potentially process next AwaitingProcessing batch
      this.triggerBatchProcessor();
    } else {
      this.logger.verbose("Batch process error", {id: this.logId, ...batch.getMetadata()}, res.err);
      batch.processingError(res.err); // Throws after MAX_BATCH_PROCESSING_ATTEMPTS

      // At least one block was successfully verified and imported, so we can be sure all
      // previous batches are valid and we only need to download the current failed batch.
      // TODO: Disabled for now
      // if (res.err instanceof ChainSegmentError && res.err.importedBlocks > 0) {
      //   this.advanceChain(batch.startEpoch);
      // }

      // The current batch could not be processed, so either this or previous batches are invalid.
      // All previous batches (AwaitingValidation) are potentially faulty and marked for retry.
      // Progress will be drop back to `this.startEpoch`
      for (const pendingBatch of this.batches.values()) {
        if (pendingBatch.startEpoch < batch.startEpoch) {
          this.logger.verbose("Batch validation error", {id: this.logId, ...pendingBatch.getMetadata()});
          pendingBatch.validationError(res.err); // Throws after MAX_BATCH_PROCESSING_ATTEMPTS
        }
      }
    }

    // A batch is no longer in Processing status, queue has an empty spot to download next batch
    this.triggerBatchDownloader();
  }

  /**
   * Drops any batches previous to `newLatestValidatedEpoch` and updates the chain boundaries
   */
  private advanceChain(newLastEpochWithProcessBlocks: Epoch): void {
    // make sure this epoch produces an advancement
    if (newLastEpochWithProcessBlocks <= this.lastEpochWithProcessBlocks) {
      return;
    }

    for (const [batchKey, batch] of this.batches.entries()) {
      if (batch.startEpoch < newLastEpochWithProcessBlocks) {
        this.batches.delete(batchKey);
        this.validatedEpochs += EPOCHS_PER_BATCH;

        // The last batch attempt is right, all others are wrong. Penalize other peers
        const attemptOk = batch.validationSuccess();
        for (const attempt of batch.failedProcessingAttempts) {
          if (attempt.hash !== attemptOk.hash) {
            if (attemptOk.peer.toString() === attempt.peer.toString()) {
              // The same peer corrected its previous attempt
              this.reportPeer(attempt.peer, PeerAction.MidToleranceError, "SyncChainInvalidBatchSelf");
            } else {
              // A different peer sent an bad batch
              this.reportPeer(attempt.peer, PeerAction.LowToleranceError, "SyncChainInvalidBatchOther");
            }
          }
        }
      }
    }

    this.lastEpochWithProcessBlocks = newLastEpochWithProcessBlocks;
  }
}

/**
 * Enforces that a report peer action is defined for all BatchErrorCode exhaustively.
 * If peer should not be downscored, returns null.
 */
export function shouldReportPeerOnBatchError(
  code: BatchErrorCode
): {action: PeerAction.LowToleranceError; reason: string} | null {
  switch (code) {
    // A batch could not be processed after max retry limit. It's likely that all peers
    // in this chain are sending invalid batches repeatedly so are either malicious or faulty.
    // We drop the chain and report all peers.
    // There are some edge cases with forks that could cause this situation, but it's unlikely.
    case BatchErrorCode.MAX_PROCESSING_ATTEMPTS:
      return {action: PeerAction.LowToleranceError, reason: "SyncChainMaxProcessingAttempts"};

    // TODO: Should peers be reported for MAX_DOWNLOAD_ATTEMPTS?
    case BatchErrorCode.WRONG_STATUS:
    case BatchErrorCode.MAX_DOWNLOAD_ATTEMPTS:
    case BatchErrorCode.MAX_EXECUTION_ENGINE_ERROR_ATTEMPTS:
      return null;
  }
}
