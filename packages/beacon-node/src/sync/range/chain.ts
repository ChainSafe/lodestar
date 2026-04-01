import {ChainForkConfig} from "@lodestar/config";
import {Epoch, Root, Slot, gloas} from "@lodestar/types";
import {ErrorAborted, LodestarError, Logger, prettyPrintIndices, toRootHex} from "@lodestar/utils";
import {isBlockInputBlobs, isBlockInputColumns} from "../../chain/blocks/blockInput/blockInput.js";
import {BlockInputErrorCode} from "../../chain/blocks/blockInput/errors.js";
import {IBlockInput} from "../../chain/blocks/blockInput/types.js";
import {BlobSidecarErrorCode} from "../../chain/errors/blobSidecarError.js";
import {BlockError, BlockErrorCode} from "../../chain/errors/blockError.js";
import {DataColumnSidecarErrorCode} from "../../chain/errors/dataColumnSidecarError.js";
import {Metrics} from "../../metrics/metrics.js";
import {PeerAction, prettyPrintPeerIdStr} from "../../network/index.js";
import {PeerSyncMeta} from "../../network/peers/peersData.js";
import {IClock} from "../../util/clock.js";
import {CustodyConfig} from "../../util/dataColumns.js";
import {ItTrigger} from "../../util/itTrigger.js";
import {PeerIdStr} from "../../util/peerId.js";
import {WarnResult, wrapError} from "../../util/wrapError.js";
import {BATCH_BUFFER_SIZE, EPOCHS_PER_BATCH, MAX_LOOK_AHEAD_EPOCHS} from "../constants.js";
import {DownloadByRangeError, DownloadByRangeErrorCode, DownloadByRangeResult} from "../utils/downloadByRange.js";
import {RangeSyncType} from "../utils/remoteSyncType.js";
import {Batch, BatchError, BatchErrorCode, BatchMetadata, BatchStatus} from "./batch.js";
import {
  ChainPeersBalancer,
  PeerSyncInfo,
  batchStartEpochIsAfterSlot,
  computeHighestTarget,
  getBatchSlotRange,
  getNextBatchToProcess,
  isSyncChainDone,
  toArr,
  toBeDownloadedStartEpoch,
  validateBatchesStatus,
} from "./utils/index.js";

const RATE_LIMITED_DOWNLOAD_RETRY_MS = 1_000;
const PEER_QUARANTINE_MS = 2 * 60_000;
const PEER_QUARANTINE_STRIKES = 2;

export type SyncChainModules = {
  config: ChainForkConfig;
  clock: IClock;
  custodyConfig: CustodyConfig;
  logger: Logger;
  metrics: Metrics | null;
};

export type SyncChainFns = {
  /**
   * Must return if ALL blocks are processed successfully
   * If SOME blocks are processed must throw BlockProcessorError()
   */
  processChainSegment: (
    blocks: IBlockInput[],
    envelopes: Map<Slot, gloas.SignedExecutionPayloadEnvelope> | null,
    syncType: RangeSyncType
  ) => Promise<void>;
  /** Must download blocks, and validate their range */
  downloadByRange: (
    peer: PeerSyncMeta,
    batch: Batch,
    syncType: RangeSyncType
  ) => Promise<WarnResult<DownloadByRangeResult, DownloadByRangeError>>;
  /** Report peer for negative actions. Decouples from the full network instance */
  reportPeer: (peer: PeerIdStr, action: PeerAction, actionName: string) => void;
  /** Gets current peer custodyColumns and earliestAvailableSlot */
  getConnectedPeerSyncMeta: (peerId: string) => PeerSyncMeta;
  /** Hook called when Chain state completes */
  onEnd: (err: Error | null, target: ChainTarget | null) => void;
  /** Deletes an array of BlockInputs from the BlockInputCache */
  pruneBlockInputs: (blockInputs: IBlockInput[]) => void;
  /** Fetches a single block by root from a specific peer and imports it */
  processBlockByRoot: (peer: PeerIdStr, blockRootHex: string, syncType: RangeSyncType) => Promise<void>;
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

// this global chain id is used to identify the chain over time, increase it every time a new chain is created
// a chain type could be Finalized or Head, so it should be appended with this id to make the log unique
let nextChainId = 0;

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
  private readonly downloadByRange: SyncChainFns["downloadByRange"];
  private readonly reportPeer: SyncChainFns["reportPeer"];
  private readonly getConnectedPeerSyncMeta: SyncChainFns["getConnectedPeerSyncMeta"];
  private readonly pruneBlockInputs: SyncChainFns["pruneBlockInputs"];
  private readonly processBlockByRoot: SyncChainFns["processBlockByRoot"];

  /** AsyncIterable that guarantees processChainSegment is run only at once at anytime */
  private readonly batchProcessor = new ItTrigger();
  /** Sorted map of batches undergoing some kind of processing. */
  private readonly batches = new Map<Epoch, Batch>();
  private readonly peerset = new Map<PeerIdStr, ChainTarget>();
  private readonly peerQuarantineUntilByPeer = new Map<PeerIdStr, number>();
  private readonly quarantineStrikeCountByPeer = new Map<PeerIdStr, number>();

  private readonly logger: Logger;
  private readonly config: ChainForkConfig;
  private readonly clock: IClock;
  private readonly metrics: Metrics | null;
  private readonly custodyConfig: CustodyConfig;

  constructor(
    initialBatchEpoch: Epoch,
    initialTarget: ChainTarget,
    syncType: RangeSyncType,
    fns: SyncChainFns,
    modules: SyncChainModules
  ) {
    const {config, clock, custodyConfig, logger, metrics} = modules;
    this.firstBatchEpoch = initialBatchEpoch;
    this.lastEpochWithProcessBlocks = initialBatchEpoch;
    this.target = initialTarget;
    this.syncType = syncType;
    this.processChainSegment = fns.processChainSegment;
    this.downloadByRange = fns.downloadByRange;
    this.reportPeer = fns.reportPeer;
    this.pruneBlockInputs = fns.pruneBlockInputs;
    this.getConnectedPeerSyncMeta = fns.getConnectedPeerSyncMeta;
    this.processBlockByRoot = fns.processBlockByRoot;
    this.config = config;
    this.clock = clock;
    this.metrics = metrics;
    this.custodyConfig = custodyConfig;
    this.logger = logger;
    this.logId = `${syncType}-${nextChainId++}`;

    if (metrics) {
      metrics.syncRange.headSyncPeers.addCollect(() => this.scrapeMetrics(metrics));
    }

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
  addPeer(peer: PeerIdStr, target: ChainTarget): void {
    const quarantineUntil = this.peerQuarantineUntilByPeer.get(peer);
    if (quarantineUntil && quarantineUntil > Date.now()) {
      return;
    }

    if (quarantineUntil) {
      this.peerQuarantineUntilByPeer.delete(peer);
    }

    this.quarantineStrikeCountByPeer.delete(peer);
    this.peerset.set(peer, target);
    this.computeTarget();
    this.triggerBatchDownloader();
  }

  /**
   * Returns true if the peer existed and has been removed
   * NOTE: The RangeSync will take care of deleting the SyncChain if peers = 0
   */
  removePeer(peerId: PeerIdStr): boolean {
    const deleted = this.peerset.delete(peerId);
    this.computeTarget();
    return deleted;
  }

  private quarantinePeer(peerId: PeerIdStr, reason: string): void {
    const quarantineUntil = Date.now() + PEER_QUARANTINE_MS;
    this.peerQuarantineUntilByPeer.set(peerId, quarantineUntil);
    this.quarantineStrikeCountByPeer.delete(peerId);
    this.removePeer(peerId);
    this.logger.verbose("Quarantined peer for post-fork sync errors", {
      id: this.logId,
      peer: prettyPrintPeerIdStr(peerId),
      reason,
      quarantineMs: PEER_QUARANTINE_MS,
      quarantineUntil,
    });
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

  getPeers(): PeerIdStr[] {
    return Array.from(this.peerset.keys());
  }

  /** Full debug state for lodestar API */
  getDebugState(): SyncChainDebugState {
    return {
      targetRoot: toRootHex(this.target.root),
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
      const targets = Array.from(this.peerset.values());
      this.target = computeHighestTarget(targets);
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

      for (const batch of this.batches.values()) {
        this.pruneBlockInputs(batch.getBlocks());
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
      this.requestBatches();
    } catch (e) {
      // bubble the error up to the main async iterable loop
      this.batchProcessor.end(e as Error);
    }
  }

  /**
   * Attempts to request the next required batches from the peer pool if the chain is syncing.
   * It will exhaust the peer pool and left over batches until the batch buffer is reached.
   */
  private requestBatches(): void {
    if (this.status !== SyncChainStatus.Syncing) {
      return;
    }

    const peersSyncInfo: PeerSyncInfo[] = [];
    for (const [peerId, target] of this.peerset.entries()) {
      try {
        peersSyncInfo.push({...this.getConnectedPeerSyncMeta(peerId), target});
      } catch (e) {
        this.logger.debug("Failed to get peer sync meta", {peerId}, e as Error);
      }
    }

    const peerBalancer = new ChainPeersBalancer(peersSyncInfo, toArr(this.batches), this.custodyConfig, this.syncType);

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
    let batch = this.includeNextBatch();
    while (batch != null) {
      const peer = peerBalancer.idlePeerForBatch(batch);
      if (!peer) {
        // if there is no peer available, we stop requesting batches because next batches will have greater startEpoch with the same sampling groups
        break;
      }
      void this.sendBatch(batch, peer);
      batch = this.includeNextBatch();
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

    // if last processed epoch is n, we don't want to request batches with epoch > n + MAX_LOOK_AHEAD_EPOCHS
    // we should have enough batches to process in the buffer: n + 1, ..., n + MAX_LOOK_AHEAD_EPOCHS
    // let's focus on redownloading these batches first because it may have to reach different peers to get enough sampled columns
    if (
      batches.length > 0 &&
      Math.max(...batches.map((b) => b.startEpoch)) >= this.lastEpochWithProcessBlocks + MAX_LOOK_AHEAD_EPOCHS
    ) {
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

    const batch = new Batch(startEpoch, this.config, this.clock, this.custodyConfig);
    this.batches.set(startEpoch, batch);
    return batch;
  }

  /**
   * Requests the batch assigned to the given id from a given peer.
   */
  private async sendBatch(batch: Batch, peer: PeerSyncMeta): Promise<void> {
    const previousEnvelopeCount = batch.getEnvelopes()?.size ?? 0;
    let nextDownloadAttemptDelayMs = 0;

    this.logger.verbose("Downloading batch", {
      id: this.logId,
      ...batch.getMetadata(),
      fork: batch.forkName,
      hasEnvelopeRequest: batch.requests.envelopesRequest != null,
      peer: prettyPrintPeerIdStr(peer.peerId),
    });
    try {
      batch.startDownloading(peer.peerId);

      // wrapError ensures to never call both batch success() and batch error()
      const res = await wrapError(this.downloadByRange(peer, batch, this.syncType));

      if (res.err) {
        const downloadErr = res.err as DownloadByRangeError;
        const isTransientDownloadError = shouldTreatAsTransientDownloadError(downloadErr);
        // There's several known error cases where we want to take action on the peer
        const errCode = (downloadErr as LodestarError<{code: string}>).type?.code;
        this.metrics?.syncRange.downloadByRange.error.inc({client: peer.client, code: errCode ?? "UNKNOWN"});
        if (this.syncType === RangeSyncType.Finalized) {
          // For finalized sync, we are stricter with peers as there is no ambiguity about which chain we're syncing.
          // The below cases indicate the peer may be on a different chain, so are not penalized during head sync.
          switch (errCode) {
            case BlockInputErrorCode.MISMATCHED_ROOT_HEX:
            case DownloadByRangeErrorCode.MISSING_BLOBS:
            case DownloadByRangeErrorCode.EXTRA_BLOBS:
            case DownloadByRangeErrorCode.MISSING_COLUMNS:
            case DownloadByRangeErrorCode.EXTRA_COLUMNS:
            case BlobSidecarErrorCode.INCORRECT_SIDECAR_COUNT:
            case BlobSidecarErrorCode.INCORRECT_BLOCK:
            case DataColumnSidecarErrorCode.INCORRECT_SIDECAR_COUNT:
            case DataColumnSidecarErrorCode.INCORRECT_BLOCK:
              this.reportPeer(peer.peerId, PeerAction.LowToleranceError, res.err.message);
          }
        }
        switch (errCode) {
          case DownloadByRangeErrorCode.EXTRA_BLOCKS:
          case DownloadByRangeErrorCode.OUT_OF_ORDER_BLOCKS:
          case DownloadByRangeErrorCode.OUT_OF_RANGE_BLOCKS:
          case DownloadByRangeErrorCode.PARENT_ROOT_MISMATCH:
          case BlobSidecarErrorCode.INCLUSION_PROOF_INVALID:
          case BlobSidecarErrorCode.INVALID_KZG_PROOF_BATCH:
          case DataColumnSidecarErrorCode.INCORRECT_KZG_COMMITMENTS_COUNT:
          case DataColumnSidecarErrorCode.INCORRECT_KZG_PROOF_COUNT:
          case DataColumnSidecarErrorCode.INVALID_KZG_PROOF_BATCH:
          case DataColumnSidecarErrorCode.INCLUSION_PROOF_INVALID:
            this.reportPeer(peer.peerId, PeerAction.LowToleranceError, res.err.message);
        }

        if (
          errCode === DownloadByRangeErrorCode.MISSING_BLOCKS_RESPONSE ||
          errCode === DownloadByRangeErrorCode.MISSING_COLUMNS_RESPONSE ||
          errCode === DownloadByRangeErrorCode.MISSING_BLOBS_RESPONSE
        ) {
          this.reportPeer(peer.peerId, PeerAction.LowToleranceError, res.err.message);
        }

        if (
          errCode === DownloadByRangeErrorCode.REQ_RESP_ERROR &&
          "reason" in downloadErr.type &&
          shouldReportPeerOnReqRespErrorReason(downloadErr.type.reason)
        ) {
          this.reportPeer(peer.peerId, PeerAction.LowToleranceError, res.err.message);
        }

        if (shouldQuarantinePeerOnDownloadError(downloadErr)) {
          const strikeCount = (this.quarantineStrikeCountByPeer.get(peer.peerId) ?? 0) + 1;
          if (strikeCount >= PEER_QUARANTINE_STRIKES) {
            this.quarantinePeer(peer.peerId, res.err.message);
          } else {
            this.quarantineStrikeCountByPeer.set(peer.peerId, strikeCount);
            this.logger.verbose("Peer hit quarantine strike", {
              id: this.logId,
              peer: prettyPrintPeerIdStr(peer.peerId),
              strikeCount,
              requiredStrikes: PEER_QUARANTINE_STRIKES,
              reason: res.err.message,
            });
          }
        } else {
          this.quarantineStrikeCountByPeer.delete(peer.peerId);
        }

        this.logger.verbose(
          "Batch download error",
          {id: this.logId, ...batch.getMetadata(), peer: prettyPrintPeerIdStr(peer.peerId)},
          res.err
        );
        batch.downloadingError(peer.peerId, {countFailedAttempt: !isTransientDownloadError}); // Throws after MAX_DOWNLOAD_ATTEMPTS
        if (isTransientDownloadError) {
          nextDownloadAttemptDelayMs = RATE_LIMITED_DOWNLOAD_RETRY_MS;
        }
      } else {
        this.logger.verbose("Batch download success", {
          id: this.logId,
          ...batch.getMetadata(),
          peer: prettyPrintPeerIdStr(peer.peerId),
        });
        this.metrics?.syncRange.downloadByRange.success.inc();
        this.quarantineStrikeCountByPeer.delete(peer.peerId);
        const {warnings, result} = res.result;
        const downloadSuccessOutput = batch.downloadingSuccess(peer.peerId, result.blocks, result.envelopes);
        const logMeta: Record<string, number> = {
          blockCount: downloadSuccessOutput.blocks.length,
        };
        const envelopesMeta = getEnvelopeLogMeta(downloadSuccessOutput.envelopes, previousEnvelopeCount);
        this.logger.debug("Batch envelopes after downloadingSuccess", {
          id: this.logId,
          epoch: batch.startEpoch,
          peer: prettyPrintPeerIdStr(peer.peerId),
          ...envelopesMeta,
        });

        if (warnings && warnings.length > 0) {
          for (const warning of warnings) {
            this.metrics?.syncRange.downloadByRange.warn.inc({client: peer.client, code: warning.type.code});
            this.logger.debug(
              "Batch downloaded with warning",
              {id: this.logId, epoch: batch.startEpoch, ...logMeta, peer: prettyPrintPeerIdStr(peer.peerId)},
              warning
            );
          }
        }

        for (const block of downloadSuccessOutput.blocks) {
          if (isBlockInputBlobs(block)) {
            const blockLogMeta = block.getLogMeta();
            const expectedBlobs = typeof blockLogMeta.expectedBlobs === "number" ? blockLogMeta.expectedBlobs : 0;
            logMeta.expectedBlobCount = (logMeta.expectedBlobCount ?? 0) + expectedBlobs;
            logMeta.receivedBlobCount = (logMeta.receivedBlobCount ?? 0) + blockLogMeta.receivedBlobs;
          } else if (isBlockInputColumns(block)) {
            logMeta.columnCount = (logMeta.columnCount ?? 0) + block.getLogMeta().receivedColumns;
          }
        }

        let logMessage: string;
        if (downloadSuccessOutput.status === BatchStatus.AwaitingProcessing) {
          logMessage = "Finished downloading batch by range";
          this.triggerBatchProcessor();
        } else {
          logMessage = "Partially downloaded batch by range. Attempting another round of downloads";
          // the flow will continue to call triggerBatchDownloader() below
        }

        this.logger.debug(logMessage, {
          id: this.logId,
          epoch: batch.startEpoch,
          ...logMeta,
          ...(envelopesMeta ?? {}),
          peer: prettyPrintPeerIdStr(peer.peerId),
        });
      }

      // Preemptively request more blocks from peers whilst we process current blocks
      //
      // TODO(fulu): why is this second call here.  should fall through to the one below the catch block. commenting
      //      for now and will resolve during PR process
      // this.triggerBatchDownloader();
    } catch (e) {
      // bubble the error up to the main async iterable loop
      this.batchProcessor.end(e as Error);
    }

    // Preemptively request more blocks from peers whilst we process current blocks.
    // For req/resp rate-limit errors, delay the retry to avoid a hot retry loop.
    if (nextDownloadAttemptDelayMs > 0) {
      setTimeout(() => this.triggerBatchDownloader(), nextDownloadAttemptDelayMs);
    } else {
      this.triggerBatchDownloader();
    }
  }

  /**
   * Sends `batch` to the processor. Note: batch may be empty
   */
  private async processBatch(batch: Batch): Promise<void> {
    const {blocks, envelopes} = batch.startProcessing();
    const processLogMeta: Record<string, number> = {blockCount: blocks.length};
    const envelopesMeta = getEnvelopeLogMeta(envelopes);
    this.logger.debug("Processing batch", {
      id: this.logId,
      epoch: batch.startEpoch,
      ...processLogMeta,
      ...(envelopesMeta ?? {}),
    });

    if (this.handleMalformedFinalizedBoundaryBatch(batch, blocks)) {
      return;
    }

    // wrapError ensures to never call both batch success() and batch error()
    let res = await wrapError(this.processChainSegment(blocks, envelopes, this.syncType));

    if (res.err && (await this.tryRecoverMissingBatchBoundaryParent(batch, blocks, res.err))) {
      res = await wrapError(this.processChainSegment(blocks, envelopes, this.syncType));
    }

    if (!res.err) {
      batch.processingSuccess();

      // Advance chain for all successfully processed batches, including empty ones.
      // Empty epochs (0 blocks) occur during periods of poor liveness — the sync
      // chain must still advance past them to avoid deadlock.
      this.advanceChain(batch.startEpoch);

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

  private handleMalformedFinalizedBoundaryBatch(batch: Batch, blocks: IBlockInput[]): boolean {
    if (this.syncType !== RangeSyncType.Finalized) {
      return false;
    }

    const firstBlock = blocks[0];
    if (firstBlock == null) {
      return false;
    }

    const attemptPeers = batch.state.status === BatchStatus.Processing ? batch.state.attempt.peers : [];
    for (const peer of attemptPeers) {
      const peerTarget = this.peerset.get(peer);
      if (peerTarget == null) {
        continue;
      }

      const peerTargetRootHex = toRootHex(peerTarget.root);
      const peerTargetInBatchRange =
        peerTarget.slot >= batch.startSlot && peerTarget.slot < batch.startSlot + batch.count;
      const missingBoundaryFromThisPeer =
        peerTargetInBatchRange && firstBlock.slot > peerTarget.slot && firstBlock.parentRootHex === peerTargetRootHex;

      if (!missingBoundaryFromThisPeer) {
        continue;
      }

      this.logger.verbose("Malformed finalized boundary batch from peer", {
        id: this.logId,
        peer: prettyPrintPeerIdStr(peer),
        batchStartSlot: batch.startSlot,
        firstBlockSlot: firstBlock.slot,
        missingBoundarySlot: peerTarget.slot,
        missingBoundaryRoot: peerTargetRootHex,
      });

      this.pruneBlockInputs(blocks);
      batch.retryDownload();
      this.quarantinePeer(peer, `missing finalized boundary block slot=${peerTarget.slot} root=${peerTargetRootHex}`);
      this.triggerBatchDownloader();
      return true;
    }

    return false;
  }

  private async tryRecoverMissingBatchBoundaryParent(
    batch: Batch,
    blocks: IBlockInput[],
    err: Error
  ): Promise<boolean> {
    if (this.syncType !== RangeSyncType.Finalized) {
      return false;
    }

    if (!(err instanceof BlockError) || err.type.code !== BlockErrorCode.PARENT_UNKNOWN) {
      return false;
    }

    const firstBlock = blocks[0];
    if (firstBlock == null || !firstBlock.hasBlock()) {
      return false;
    }

    // A peer may respond to the first finalized batch after a checkpoint boundary with
    // slot N+1.. instead of including the boundary block at slot N. If the first block
    // is exactly one slot after the requested batch start and its parent is unknown,
    // recover that boundary parent by root and retry the batch immediately.
    if (firstBlock.slot !== batch.startSlot + 1 || firstBlock.parentRootHex !== err.type.parentRoot) {
      return false;
    }

    const attemptPeers = batch.state.status === BatchStatus.Processing ? batch.state.attempt.peers : [];
    for (const peer of attemptPeers) {
      const recovered = await wrapError(this.processBlockByRoot(peer, err.type.parentRoot, this.syncType));
      if (!recovered.err) {
        this.logger.debug("Recovered missing batch boundary parent by root", {
          id: this.logId,
          peer: prettyPrintPeerIdStr(peer),
          batchStartSlot: batch.startSlot,
          recoveredParentRoot: err.type.parentRoot,
          childSlot: firstBlock.slot,
        });
        return true;
      }

      this.logger.verbose(
        "Failed to recover missing batch boundary parent by root",
        {
          id: this.logId,
          peer: prettyPrintPeerIdStr(peer),
          batchStartSlot: batch.startSlot,
          recoveredParentRoot: err.type.parentRoot,
          childSlot: firstBlock.slot,
        },
        recovered.err
      );
    }

    return false;
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
            for (const badAttemptPeer of attempt.peers) {
              if (attemptOk.peers.find((goodPeer) => goodPeer === badAttemptPeer)) {
                // The same peer corrected its previous attempt
                this.reportPeer(badAttemptPeer, PeerAction.MidToleranceError, "SyncChainInvalidBatchSelf");
              } else {
                // A different peer sent an bad batch
                this.reportPeer(badAttemptPeer, PeerAction.LowToleranceError, "SyncChainInvalidBatchOther");
              }
            }
          }
        }
      }
    }

    this.lastEpochWithProcessBlocks = newLastEpochWithProcessBlocks;
    this.logger.verbose("Advanced chain", {
      id: this.logId,
      lastEpochWithProcessBlocks: this.lastEpochWithProcessBlocks,
    });
  }

  private scrapeMetrics(metrics: Metrics): void {
    const syncPeersMetric =
      this.syncType === RangeSyncType.Finalized
        ? metrics.syncRange.finalizedSyncPeers
        : metrics.syncRange.headSyncPeers;

    const peersSyncMeta = new Map<PeerIdStr, PeerSyncMeta>();
    for (const peerId of this.peerset.keys()) {
      try {
        peersSyncMeta.set(peerId, this.getConnectedPeerSyncMeta(peerId));
      } catch (_) {
        // ignore for metric as peer could be disconnected
      }
    }

    const peersByColumnIndex = new Map<number, number>();
    for (const [columnIndex, column] of this.custodyConfig.sampledColumns.entries()) {
      for (const {custodyColumns} of peersSyncMeta.values()) {
        if (custodyColumns.includes(column)) {
          peersByColumnIndex.set(columnIndex, (peersByColumnIndex.get(columnIndex) ?? 0) + 1);
        }
      }
    }

    for (let columnIndex = 0; columnIndex < this.custodyConfig.sampledColumns.length; columnIndex++) {
      const peerCount = peersByColumnIndex.get(columnIndex) ?? 0;
      syncPeersMetric.set({columnIndex}, peerCount);
    }
  }
}

/**
 * Enforces that a report peer action is defined for all BatchErrorCode exhaustively.
 * If peer should not be downscored, returns null.
 */
function shouldTreatAsTransientDownloadError(err: DownloadByRangeError): boolean {
  switch (err.type.code) {
    case DownloadByRangeErrorCode.MISSING_BLOCKS_RESPONSE:
    case DownloadByRangeErrorCode.MISSING_COLUMNS_RESPONSE:
    case DownloadByRangeErrorCode.MISSING_BLOBS_RESPONSE:
      return true;

    case DownloadByRangeErrorCode.REQ_RESP_ERROR: {
      const reason = err.type.reason;
      return (
        reason.includes("REQUEST_ERROR_SELF_RATE_LIMITED") ||
        reason.includes("REQUEST_ERROR_RATE_LIMITED") ||
        reason.includes("RESPONSE_ERROR_RATE_LIMITED") ||
        reason.includes("REQUEST_ERROR_DIAL_ERROR") ||
        reason.includes("REQUEST_ERROR_INVALID_REQUEST") ||
        reason.includes("REQUEST_ERROR_TTFB_TIMEOUT") ||
        reason.includes("REQUEST_ERROR_BODY_TIMEOUT") ||
        reason.includes("Message was truncated")
      );
    }

    default:
      return false;
  }
}

function shouldReportPeerOnReqRespErrorReason(reason: string): boolean {
  return (
    reason.includes("REQUEST_ERROR_DIAL_ERROR") ||
    reason.includes("REQUEST_ERROR_INVALID_REQUEST") ||
    reason.includes("Message was truncated")
  );
}

function shouldQuarantinePeerOnDownloadError(err: DownloadByRangeError): boolean {
  switch (err.type.code) {
    case DownloadByRangeErrorCode.MISSING_COLUMNS_RESPONSE:
      return true;

    case DownloadByRangeErrorCode.REQ_RESP_ERROR:
      return (
        err.type.reason.includes("unexpected end of input") ||
        err.type.reason.includes("REQUEST_ERROR_INVALID_REQUEST") ||
        err.type.reason.includes("Message was truncated")
      );

    default:
      return false;
  }
}

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
    case BatchErrorCode.MAX_DOWNLOAD_ATTEMPTS:
    case BatchErrorCode.INVALID_COUNT:
    case BatchErrorCode.WRONG_STATUS:
    case BatchErrorCode.MAX_EXECUTION_ENGINE_ERROR_ATTEMPTS:
      return null;
  }
}

function getEnvelopeLogMeta(
  envelopes: Map<Slot, gloas.SignedExecutionPayloadEnvelope> | null,
  previousEnvelopeCount = 0
): {envelopeCount: number; newEnvelopeCount: number; envelopeSlots: string | null} {
  if (!envelopes || envelopes.size === 0) {
    return {
      envelopeCount: 0,
      newEnvelopeCount: 0,
      envelopeSlots: null,
    };
  }

  const envelopeSlots = Array.from(envelopes.keys()).sort((a, b) => a - b);

  return {
    envelopeCount: envelopes.size,
    newEnvelopeCount: Math.max(envelopes.size - previousEnvelopeCount, 0),
    envelopeSlots: prettyPrintIndices(envelopeSlots),
  };
}
