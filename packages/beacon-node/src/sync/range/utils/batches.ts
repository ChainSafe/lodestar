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
  ThisBatch = "ThisBatch",
  /** This batch is valid, but a previous batch did not deliver the parent. */
  PreviousBatch = "PreviousBatch",
  /** The fault could be in this batch or a previous batch, so hedge both ways. */
  Ambiguous = "Ambiguous",
}

/**
 * Classify a processChainSegment error for a batch so range sync only redownloads
 * the batch or batches that could actually be at fault.
 */
export function classifyProcessingFault(err: Error, batch: Batch, prevBatch: Batch | undefined): ProcessingFaultKind {
  if (!(err instanceof BlockError)) {
    return ProcessingFaultKind.ThisBatch;
  }

  const {code} = err.type;
  if (code !== BlockErrorCode.PARENT_BLOCK_UNKNOWN && code !== BlockErrorCode.PARENT_PAYLOAD_UNKNOWN) {
    return ProcessingFaultKind.ThisBatch;
  }

  const firstBlockSlot = err.signedBlock.message.slot;
  if (firstBlockSlot === batch.startSlot) {
    return prevBatch === undefined ? ProcessingFaultKind.ThisBatch : ProcessingFaultKind.PreviousBatch;
  }

  const prevTailSlot = batch.startSlot - 1;
  const prevHasFullTail =
    code === BlockErrorCode.PARENT_PAYLOAD_UNKNOWN
      ? (prevBatch?.getPayloadEnvelopes()?.get(prevTailSlot)?.hasPayloadEnvelope() ?? false)
      : (prevBatch?.getBlocks().some((b) => b.slot === prevTailSlot) ?? false);

  return prevHasFullTail ? ProcessingFaultKind.ThisBatch : ProcessingFaultKind.Ambiguous;
}
