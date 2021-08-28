import {Slot} from "@chainsafe/lodestar-types";
import {LodestarError} from "@chainsafe/lodestar-utils";

/**
 * Result of adding data to an operation pool of an aggregatable object.
 */
export enum InsertOutcome {
  /** The data had not been seen before and was added to the pool. */
  NewData = "NewData",
  /** A validator signature for a participant of this data is already known. No changes were made. */
  AlreadyKnown = "AlreadyKnown",
  /** Not existing in the pool but it's too old to add. No changes were made. */
  Old = "Old",
  /** The data is know, and the new participants have been added to the aggregated signature */
  Aggregated = "Aggregated",
  /** The data is not better than the existing data*/
  NotBetterThan = "NotBetterThan",
}

export enum OpPoolErrorCode {
  /** The given object slot was too low to be stored. No changes were made. */
  SLOT_TOO_LOW = "OP_POOL_ERROR_SLOT_TOO_LOW",
  /** Reached max number of unique objects per slot. This is a DoS protection function. */
  REACHED_MAX_PER_SLOT = "OP_POOL_ERROR_REACHED_MAX_PER_SLOT",
}

export type OpPoolErrorType =
  | {code: OpPoolErrorCode.SLOT_TOO_LOW; slot: Slot; lowestPermissibleSlot: Slot}
  | {code: OpPoolErrorCode.REACHED_MAX_PER_SLOT};

export class OpPoolError extends LodestarError<OpPoolErrorType> {}
