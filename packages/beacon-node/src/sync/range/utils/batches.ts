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
 * Where a batch processing error should be attributed, so we re-download only the batch(es)
 * actually at fault instead of tearing the whole chain down on any error.
 */
export enum ProcessingFaultKind {
  // This batch's own blocks are bad/short => re-download this batch.
  ThisBatch = "ThisBatch",
  // This batch is valid; a previous batch didn't deliver the parent => retain & re-process
  // this batch, invalidate the previous batch(es)
  PreviousBatch = "PreviousBatch",
  // Could be either (this batch's leading withhold or the previous batch's short tail)
  // => re-download this batch AND invalidate the previous batch(es).
  Ambiguous = "Ambiguous",
}

/**
 * Classify a `processChainSegment` error for `batch`.
 *
 * Relies on the invariant that when `batch` is processed, every earlier batch is
 * `AwaitingValidation` = already imported (see `getNextBatchToProcess`). Given that:
 * - Non-parent errors (bad signature/state/payload) are always this batch's own fault.
 * - `PARENT_UNKNOWN`/`PARENT_PAYLOAD_UNKNOWN` fires on the batch's first block.
 *   If that block is anchored at `startSlot`, the missing parent lies before the batch
 *   => previous-batch fault. Otherwise the missing parent could live inside this batch's own
 *   leading range — certain only if the previous batch delivered a full tail (a block/payload
 *   at `startSlot - 1`), else ambiguous.
 *
 * NOTE: this attribution assumes a single canonical chain and is precise for finalized sync.
 * Head-sync peers may be on different forks; the actions are still safe there (retries can
 * converge onto the target fork), but peer penalization on teardown is gated to finalized sync.
 */
export function classifyProcessingFault(err: Error, batch: Batch, prevBatch: Batch | undefined): ProcessingFaultKind {
  if (!(err instanceof BlockError)) return ProcessingFaultKind.ThisBatch;
  const {code} = err.type;
  // Only the segment-boundary parent codes can implicate a previous batch. Everything else —
  // including the internal-linkage codes NON_LINEAR_PARENT_ROOTS / NON_LINEAR_PAYLOAD_ROOTS — is
  // this batch's own bad data. PARENT_UNKNOWN/PARENT_PAYLOAD_UNKNOWN are guaranteed to fire only
  // on a segment's first block (see verifyBlocksSanityChecks and chainSegment's i === 0 branch).
  if (code !== BlockErrorCode.PARENT_UNKNOWN && code !== BlockErrorCode.PARENT_PAYLOAD_UNKNOWN) {
    return ProcessingFaultKind.ThisBatch;
  }

  // PARENT_UNKNOWN/PARENT_PAYLOAD_UNKNOWN always fires on the batch's first not-yet-imported block.
  const firstBlockSlot = err.signedBlock.message.slot;
  // Anchored at the batch start => the missing parent is before this batch => previous-batch fault.
  if (firstBlockSlot === batch.startSlot) return ProcessingFaultKind.PreviousBatch;

  // firstBlockSlot > startSlot: this-batch fault ONLY if the previous batch delivered a full
  // tail (a block/payload at startSlot - 1). Otherwise it is ambiguous.
  const prevTailSlot = batch.startSlot - 1;
  const prevHasFullTail =
    code === BlockErrorCode.PARENT_PAYLOAD_UNKNOWN
      ? (prevBatch?.getPayloadEnvelopes()?.get(prevTailSlot)?.hasPayloadEnvelope() ?? false)
      : (prevBatch?.getBlocks().some((b) => b.slot === prevTailSlot) ?? false);
  return prevHasFullTail ? ProcessingFaultKind.ThisBatch : ProcessingFaultKind.Ambiguous;
}
