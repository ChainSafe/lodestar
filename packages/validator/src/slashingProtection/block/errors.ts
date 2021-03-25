import {Slot, phase0} from "@chainsafe/lodestar-types";
import {LodestarError} from "@chainsafe/lodestar-utils";

export enum InvalidBlockErrorCode {
  /**
   * The block has the same slot as a block from the DB
   */
  DOUBLE_BLOCK_PROPOSAL = "ERR_INVALID_BLOCK_DOUBLE_BLOCK_PROPOSAL",
  /**
   * The block is invalid because its slot is less than the lower bound slot for this validator.
   */
  SLOT_LESS_THAN_LOWER_BOUND = "ERR_INVALID_BLOCK_SLOT_LESS_THAN_LOWER_BOUND",
}

type InvalidBlockErrorType =
  | {
      code: InvalidBlockErrorCode.DOUBLE_BLOCK_PROPOSAL;
      block: phase0.SlashingProtectionBlock;
      block2: phase0.SlashingProtectionBlock;
    }
  | {
      code: InvalidBlockErrorCode.SLOT_LESS_THAN_LOWER_BOUND;
      slot: Slot;
      minSlot: Slot;
    };

export class InvalidBlockError extends LodestarError<InvalidBlockErrorType> {
  constructor(type: InvalidBlockErrorType) {
    super(type);
  }
}
