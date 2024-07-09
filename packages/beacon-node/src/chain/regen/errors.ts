import {Root, Slot, RootHex} from "@lodestar/types";

export enum RegenErrorCode {
  BLOCK_NOT_IN_FORKCHOICE = "REGEN_ERROR_BLOCK_NOT_IN_FORKCHOICE",
  STATE_NOT_IN_FORKCHOICE = "REGEN_ERROR_STATE_NOT_IN_FORKCHOICE",
  SLOT_BEFORE_BLOCK_SLOT = "REGEN_ERROR_SLOT_BEFORE_BLOCK_SLOT",
  NO_SEED_STATE = "REGEN_ERROR_NO_SEED_STATE",
  TOO_MANY_BLOCK_PROCESSED = "REGEN_ERROR_TOO_MANY_BLOCK_PROCESSED",
  BLOCK_NOT_IN_DB = "REGEN_ERROR_BLOCK_NOT_IN_DB",
  STATE_TRANSITION_ERROR = "REGEN_ERROR_STATE_TRANSITION_ERROR",
  INVALID_STATE_ROOT = "REGEN_ERROR_INVALID_STATE_ROOT",
}

export type RegenErrorType =
  | {code: RegenErrorCode.BLOCK_NOT_IN_FORKCHOICE; blockRoot: RootHex | Root}
  | {code: RegenErrorCode.STATE_NOT_IN_FORKCHOICE; stateRoot: RootHex | Root}
  | {code: RegenErrorCode.SLOT_BEFORE_BLOCK_SLOT; slot: Slot; blockSlot: Slot}
  | {code: RegenErrorCode.NO_SEED_STATE}
  | {code: RegenErrorCode.TOO_MANY_BLOCK_PROCESSED; stateRoot: RootHex | Root}
  | {code: RegenErrorCode.BLOCK_NOT_IN_DB; blockRoot: RootHex | Root}
  | {code: RegenErrorCode.STATE_TRANSITION_ERROR; error: Error}
  | {code: RegenErrorCode.INVALID_STATE_ROOT; slot: Slot; expected: RootHex; actual: RootHex};

export class RegenError extends Error {
  type: RegenErrorType;
  constructor(type: RegenErrorType) {
    super(type.code);
    this.type = type;
  }
}
