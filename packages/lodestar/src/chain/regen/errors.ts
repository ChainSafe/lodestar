import {Root, Slot} from "@chainsafe/lodestar-types";

export enum RegenErrorCode {
  ERR_BLOCK_NOT_IN_FORKCHOICE = "ERR_BLOCK_NOT_IN_FORKCHOICE",
  ERR_STATE_NOT_IN_FORKCHOICE = "ERR_STATE_NOT_IN_FORKCHOICE",
  ERR_SLOT_BEFORE_BLOCK_SLOT = "ERR_SLOT_BEFORE_BLOCK_SLOT",
  ERR_NO_SEED_STATE = "ERR_NO_SEED_STATE",
  ERR_TOO_MANY_BLOCK_PROCESSED = "ERR_TOO_MANY_BLOCK_PROCESSED",
  ERR_BLOCK_NOT_IN_DB = "ERR_BLOCK_NOT_IN_DB",
  ERR_STATE_TRANSITION_ERROR = "ERR_STATE_TRANSITION_ERROR",
}

export type RegenErrorType =
  | {
      code: RegenErrorCode.ERR_BLOCK_NOT_IN_FORKCHOICE;
      blockRoot: Root;
    }
  | {
      code: RegenErrorCode.ERR_STATE_NOT_IN_FORKCHOICE;
      stateRoot: Root;
    }
  | {
      code: RegenErrorCode.ERR_SLOT_BEFORE_BLOCK_SLOT;
      slot: Slot;
      blockSlot: Slot;
    }
  | {
      code: RegenErrorCode.ERR_NO_SEED_STATE;
    }
  | {
      code: RegenErrorCode.ERR_TOO_MANY_BLOCK_PROCESSED;
      stateRoot: Root;
    }
  | {
      code: RegenErrorCode.ERR_BLOCK_NOT_IN_DB;
      blockRoot: Root;
    }
  | {
      code: RegenErrorCode.ERR_STATE_TRANSITION_ERROR;
      error: Error;
    };

export class RegenError extends Error {
  type: RegenErrorType;
  constructor(type: RegenErrorType) {
    super(type.code);
    this.type = type;
  }
}
