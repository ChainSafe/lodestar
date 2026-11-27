import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch, Slot} from "@lodestar/types";
import {BlockError, BlockErrorCode} from "../../../chain/errors/index.js";
import {BATCH_SLOT_OFFSET, EPOCHS_PER_BATCH} from "../../constants.js";
import {Batch, BatchStatus} from "../batch.js";

/**
 * Validates that the status and ordering of batches is valid
 * ```
 * [AwaitingValidation]* [Processing]? [AwaitingDownload,Downloading,AwaitingProcessing]*
 * ```
 */
export function validateBatchesStatus(batches: Batch[]): void {
  let processing = 0;
  let preProcessing = 0;
  for (const batch of batches) {
    const status = batch.state.status;
    switch (status) {
      case BatchStatus.AwaitingValidation:
        if (processing > 0) throw Error("AwaitingValidation state found after Processing");
        if (preProcessing > 0) throw Error("AwaitingValidation state found after PreProcessing");
        break;

      case BatchStatus.Processing:
        if (preProcessing > 0) throw Error("Processing state found after PreProcessing");
        if (processing > 0) throw Error("More than one Processing state found");
        processing++;
        break;

      case BatchStatus.AwaitingDownload:
      case BatchStatus.Downloading:
      case BatchStatus.AwaitingProcessing:
        preProcessing++;
        break;

      default:
        throw Error(`Unknown status: ${status}`);
    }
  }
}

/**
 * Return the next batch to process if any.
 * @see validateBatchesStatus for batches state description
 */
export function getNextBatchToProcess(batches: Batch[]): Batch | null {
  for (const batch of batches) {
    switch (batch.state.status) {
      // If an AwaitingProcessing batch exists it can only be preceeded by AwaitingValidation
      case BatchStatus.AwaitingValidation:
        break;

      case BatchStatus.AwaitingProcessing:
        return batch;

      // There MUST be no AwaitingProcessing state after AwaitingDownload, Downloading, Processing
      case BatchStatus.AwaitingDownload:
      case BatchStatus.Downloading:
      case BatchStatus.Processing:
        return null;
    }
  }
  // Exhausted batches
  return null;
}

/**
 * Compute the startEpoch of the next batch to be downloaded
 */
export function toBeDownloadedStartEpoch(batches: Batch[], startEpoch: Epoch): Epoch {
  // Note: batches are inserted in ascending `startEpoch` order
  const lastBatch = batches.at(-1);
  return lastBatch ? lastBatch.startEpoch + EPOCHS_PER_BATCH : startEpoch;
}

export function toArr<K, V>(map: Map<K, V>): V[] {
  return Array.from(map.values());
}

export function getBatchSlotRange(startEpoch: Epoch): {startSlot: number; count: number} {
  return {
    startSlot: computeStartSlotAtEpoch(startEpoch) + BATCH_SLOT_OFFSET,
    count: EPOCHS_PER_BATCH * SLOTS_PER_EPOCH,
  };
}

/**
 * Given a batch's startEpoch, return true if batch does not include slot and is strictly after
 * ```
 *        Batch1   Batch2   Batch3
 *  ----|--------|-----X--|--------|---
 * ```
 *  - Batch1 = not includes and before = false
 *  - Batch2 = includes                = false
 *  - Batch3 = not includes and after  = true
 */
export function batchStartEpochIsAfterSlot(startEpoch: Epoch, targetSlot: Slot): boolean {
  // The range of slots (inclusive) downloaded by a batch
  const {startSlot} = getBatchSlotRange(startEpoch);

  return startSlot > targetSlot;
}

/**
 * Returns true if SyncChain has processed all possible blocks with slot <= target.slot
 */
export function isSyncChainDone(batches: Batch[], lastEpochWithProcessBlocks: Epoch, targetSlot: Slot): boolean {
  // In case of full epochs of skipped slots, lastEpochWithProcessBlocks won't be updated.
  // In that case it is assumed that the batches are valid only to be able to mark this SyncChain as done
  const lastAwaitingValidation = batches
    .reverse()
    .find((batch) => batch.state.status === BatchStatus.AwaitingValidation);

  if (lastAwaitingValidation) {
    return batchStartEpochIsAfterSlot(lastAwaitingValidation.startEpoch + EPOCHS_PER_BATCH, targetSlot);
  }

  return batchStartEpochIsAfterSlot(lastEpochWithProcessBlocks, targetSlot);
}

/**
 * Where a batch processing error should be attributed.
 */
export enum ProcessingFaultKind {
  /** This batch's own blocks are bad or incomplete, so redownload this batch. */
  CurrentBatch = "CurrentBatch",
  /** This batch is valid, but the parent batch did not deliver the parent. */
  ParentBatch = "ParentBatch",
  /** The fault could be in this batch or the parent batch, so hedge both ways. */
  Ambiguous = "Ambiguous",
}

export type ProcessingFault =
  | {kind: ProcessingFaultKind.CurrentBatch}
  | {kind: ProcessingFaultKind.ParentBatch; parentBatch: Batch}
  | {kind: ProcessingFaultKind.Ambiguous; parentBatch: Batch};

/**
 * Classify a processChainSegment error for a batch so range sync only redownloads
 * the batch or batches that could actually be at fault.
 * Note that range sync is supposed to only handle linear chain, for forky condition we'll handle it via backward sync
 * in BlockInputSync or the upcoming/TODO beacon_blocks_by_head req/resp.
 *
 * `parentBatch` is the last batch with blocks before `batch`, it may be followed by 0-block batches. If no batch with
 * blocks awaits validation, it is the first 0-block batch before `batch`.
 * Epochs with 0 blocks usually happen on devnets, during periods of poor liveness when no proposer gets a block
 * included for whole epochs. A wrong 0-block response only shows up as an unknown parent in `batch`, so with 0-block
 * batches in between the fault is never pinned on `batch` alone: `parentBatch` and the 0-block batches after it are
 * downloaded again.
 */
export function classifyProcessingFault(err: Error, batch: Batch, parentBatch: Batch | undefined): ProcessingFault {
  if (!(err instanceof BlockError)) {
    return {kind: ProcessingFaultKind.CurrentBatch};
  }

  const {code} = err.type;
  if (code !== BlockErrorCode.PARENT_BLOCK_UNKNOWN && code !== BlockErrorCode.PARENT_PAYLOAD_UNKNOWN) {
    return {kind: ProcessingFaultKind.CurrentBatch};
  }

  if (parentBatch === undefined) {
    return {kind: ProcessingFaultKind.CurrentBatch};
  }

  const firstErrorSlot = err.signedBlock.message.slot;
  if (firstErrorSlot === batch.startSlot) {
    // note that range sync is for linear chain, so this is clearly an issue of the parent batch
    return {kind: ProcessingFaultKind.ParentBatch, parentBatch};
  }

  // `parentBatch` can be followed by 0-block batches, so its tail is the end of its own range
  const parentTailSlot = parentBatch.startSlot + parentBatch.count - 1;
  const parentHasFullTail =
    code === BlockErrorCode.PARENT_PAYLOAD_UNKNOWN
      ? (parentBatch.getPayloadEnvelopes()?.get(parentTailSlot)?.hasPayloadEnvelope() ?? false)
      : parentBatch.getBlocks().some((b) => b.slot === parentTailSlot);

  // With 0-block batches in between, it could be a wrong 0-block batch
  const hasZeroBlockGap = parentTailSlot + 1 < batch.startSlot;

  // Assumes the tail block / payload delivered by `parentBatch` is canonical. If it is orphaned, `parentBatch` is at
  // fault: `batch` keeps failing until MAX_PROCESSING_ATTEMPTS and a new SyncChain is created.
  if (parentHasFullTail && !hasZeroBlockGap) {
    return {kind: ProcessingFaultKind.CurrentBatch};
  }
  return {kind: ProcessingFaultKind.Ambiguous, parentBatch};
}
