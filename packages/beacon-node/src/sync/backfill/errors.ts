import {RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";

export enum BackfillSyncErrorCode {
  /** Peer has neither a block in the requested range nor the block with the expected root */
  BLOCK_UNAVAILABLE = "BACKFILL_SYNC_ERROR_BLOCK_UNAVAILABLE",
  /** Block slot is outside of the requested range or not below the earliest stored block */
  OUT_OF_RANGE_BLOCK = "BACKFILL_SYNC_ERROR_OUT_OF_RANGE_BLOCK",
  OUT_OF_ORDER_BLOCKS = "BACKFILL_SYNC_ERROR_OUT_OF_ORDER_BLOCKS",
  /** Blocks do not form a chain ending at the parent of the earliest stored block */
  NOT_LINEAR = "BACKFILL_SYNC_ERROR_NOT_LINEAR",
  UNKNOWN_PROPOSER = "BACKFILL_SYNC_ERROR_UNKNOWN_PROPOSER",
  INVALID_PROPOSER_SIGNATURE = "BACKFILL_SYNC_ERROR_INVALID_PROPOSER_SIGNATURE",
  /** Sidecar header carries a different signature than the verified block */
  INVALID_SIDECAR_HEADER_SIGNATURE = "BACKFILL_SYNC_ERROR_INVALID_SIDECAR_HEADER_SIGNATURE",
  /** No connected peer serves the custody columns still missing for the batch */
  COLUMNS_UNAVAILABLE = "BACKFILL_SYNC_ERROR_COLUMNS_UNAVAILABLE",
  /** Peer did not return the envelope of a block whose payload is canonical */
  ENVELOPE_UNAVAILABLE = "BACKFILL_SYNC_ERROR_ENVELOPE_UNAVAILABLE",
  /** Envelope does not match the block or the bid the proposer committed to */
  INCONSISTENT_ENVELOPE = "BACKFILL_SYNC_ERROR_INCONSISTENT_ENVELOPE",
  INVALID_ENVELOPE_SIGNATURE = "BACKFILL_SYNC_ERROR_INVALID_ENVELOPE_SIGNATURE",
  /** Earliest available slot or backfill target moved while the batch was in flight */
  STALE_BATCH = "BACKFILL_SYNC_ERROR_STALE_BATCH",
}

export type BackfillSyncErrorType =
  | {code: BackfillSyncErrorCode.BLOCK_UNAVAILABLE; root: RootHex; startSlot: Slot; count: number}
  | {code: BackfillSyncErrorCode.OUT_OF_RANGE_BLOCK; slot: Slot; startSlot: Slot; endSlot: Slot}
  | {code: BackfillSyncErrorCode.OUT_OF_ORDER_BLOCKS; slot: Slot}
  | {code: BackfillSyncErrorCode.NOT_LINEAR; slot: Slot; expected: RootHex; actual: RootHex}
  | {code: BackfillSyncErrorCode.UNKNOWN_PROPOSER; slot: Slot; proposerIndex: ValidatorIndex}
  | {code: BackfillSyncErrorCode.INVALID_PROPOSER_SIGNATURE; startSlot: Slot; count: number}
  | {code: BackfillSyncErrorCode.INVALID_SIDECAR_HEADER_SIGNATURE; slot: Slot; columnIndex: number}
  | {code: BackfillSyncErrorCode.COLUMNS_UNAVAILABLE; startSlot: Slot; count: number; missingColumns: string}
  | {code: BackfillSyncErrorCode.ENVELOPE_UNAVAILABLE; slot: Slot; root: RootHex}
  | {code: BackfillSyncErrorCode.INCONSISTENT_ENVELOPE; slot: Slot; root: RootHex; field: string}
  | {code: BackfillSyncErrorCode.INVALID_ENVELOPE_SIGNATURE; startSlot: Slot; count: number}
  | {code: BackfillSyncErrorCode.STALE_BATCH; startSlot: Slot; earliestAvailableSlot: Slot; targetSlot: Slot};

export class BackfillSyncError extends LodestarError<BackfillSyncErrorType> {}
