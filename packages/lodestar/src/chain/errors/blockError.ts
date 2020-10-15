import {Root, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {LodestarError} from "@chainsafe/lodestar-utils";

import {IBlockJob} from "../interface";

export enum BlockErrorCode {
  /**
   * The prestate cannot be fetched
   */
  ERR_PRESTATE_MISSING = "ERR_PRESTATE_MISSING",
  /**
   * The parent block was unknown.
   */
  ERR_PARENT_UNKNOWN = "ERR_PARENT_UNKNOWN",
  /**
   * The block slot is greater than the present slot.
   */
  ERR_FUTURE_SLOT = "ERR_FUTURE_SLOT",
  /**
   * The block state_root does not match the generated state.
   */
  ERR_STATE_ROOT_MISMATCH = "ERR_STATE_ROOT_MISMATCH",
  /**
   * The block was a genesis block, these blocks cannot be re-imported.
   */
  ERR_GENESIS_BLOCK = "ERR_GENESIS_BLOCK",
  /**
   * The slot is finalized, no need to import.
   */
  ERR_WOULD_REVERT_FINALIZED_SLOT = "ERR_WOULD_REVERT_FINALIZED_SLOT",
  /**
   * Block is already known, no need to re-import.
   */
  ERR_BLOCK_IS_ALREADY_KNOWN = "ERR_BLOCK_IS_ALREADY_KNOWN",
  /**
   * A block for this proposer and slot has already been observed.
   */
  ERR_REPEAT_PROPOSAL = "ERR_REPEAT_PROPOSAL",
  /**
   * The block slot exceeds the MAXIMUM_BLOCK_SLOT_NUMBER.
   */
  ERR_BLOCK_SLOT_LIMIT_REACHED = "ERR_BLOCK_SLOT_LIMIT_REACHED",
  /**
   * The `BeaconBlock` has a `proposer_index` that does not match the index we computed locally.
   */
  ERR_INCORRECT_PROPOSER = "ERR_INCORRECT_PROPOSER",
  /**
   * The proposal signature in invalid.
   */
  ERR_PROPOSAL_SIGNATURE_INVALID = "ERR_PROPOSAL_SIGNATURE_INVALID",
  /**
   * The `block.proposer_index` is not known.
   */
  ERR_UNKNOWN_PROPOSER = "ERR_UNKNOWN_PROPOSER",
  /**
   * A signature in the block is invalid (exactly which is unknown).
   */
  ERR_INVALID_SIGNATURE = "ERR_INVALID_SIGNATURE",
  /**
   * The provided block is from an later slot than its parent.
   */
  ERR_BLOCK_IS_NOT_LATER_THAN_PARENT = "ERR_BLOCK_IS_NOT_LATER_THAN_PARENT",
  /**
   * At least one block in the chain segment did not have it's parent root set to the root of the prior block.
   */
  ERR_NON_LINEAR_PARENT_ROOTS = "ERR_NON_LINEAR_PARENT_ROOTS",
  /**
   * The slots of the blocks in the chain segment were not strictly increasing.
   * I.e., a child had lower slot than a parent.
   */
  ERR_NON_LINEAR_SLOTS = "ERR_NON_LINEAR_SLOTS",
  /**
   * The block failed the specification's `per_block_processing` function, it is invalid.
   */
  ERR_PER_BLOCK_PROCESSING_ERROR = "ERR_PER_BLOCK_PROCESSING_ERROR",
  /**
   * There was an error whilst processing the block. It is not necessarily invalid.
   */
  ERR_BEACON_CHAIN_ERROR = "ERR_BEACON_CHAIN_ERROR",
  /**
   * Block did not pass validation during block processing.
   */
  ERR_KNOWN_BAD_BLOCK = "ERR_KNOWN_BAD_BLOCK",
}

export type BlockErrorLogContext = {
  blockSlot?: Slot;
  blockRoot?: string;
};

export type BlockErrorType = (
  | {
      code: BlockErrorCode.ERR_PRESTATE_MISSING;
    }
  | {
      code: BlockErrorCode.ERR_PARENT_UNKNOWN;
      parentRoot: Root;
    }
  | {
      code: BlockErrorCode.ERR_FUTURE_SLOT;
      blockSlot: Slot;
      currentSlot: Slot;
    }
  | {
      code: BlockErrorCode.ERR_STATE_ROOT_MISMATCH;
    }
  | {
      code: BlockErrorCode.ERR_GENESIS_BLOCK;
    }
  | {
      code: BlockErrorCode.ERR_WOULD_REVERT_FINALIZED_SLOT;
      blockSlot: Slot;
      finalizedSlot: Slot;
    }
  | {
      code: BlockErrorCode.ERR_BLOCK_IS_ALREADY_KNOWN;
    }
  | {
      code: BlockErrorCode.ERR_REPEAT_PROPOSAL;
      proposer: ValidatorIndex;
    }
  | {
      code: BlockErrorCode.ERR_BLOCK_SLOT_LIMIT_REACHED;
    }
  | {
      code: BlockErrorCode.ERR_INCORRECT_PROPOSER;
      blockProposer: ValidatorIndex;
    }
  | {
      code: BlockErrorCode.ERR_PROPOSAL_SIGNATURE_INVALID;
    }
  | {
      code: BlockErrorCode.ERR_UNKNOWN_PROPOSER;
      proposer: ValidatorIndex;
    }
  | {
      code: BlockErrorCode.ERR_BLOCK_IS_NOT_LATER_THAN_PARENT;
      blockSlot: Slot;
      stateSlot: Slot;
    }
  | {
      code: BlockErrorCode.ERR_NON_LINEAR_PARENT_ROOTS;
    }
  | {
      code: BlockErrorCode.ERR_NON_LINEAR_SLOTS;
    }
  | {
      code: BlockErrorCode.ERR_PER_BLOCK_PROCESSING_ERROR;
      error: Error;
    }
  | {
      code: BlockErrorCode.ERR_BEACON_CHAIN_ERROR;
      error: Error;
    }
  | {
      code: BlockErrorCode.ERR_KNOWN_BAD_BLOCK;
    }
) &
  BlockErrorLogContext;

type JobObject = {
  job: IBlockJob;
};

export class BlockError extends LodestarError<BlockErrorType> {
  public job: IBlockJob;

  constructor({job, ...type}: BlockErrorType & JobObject) {
    super(type);
    this.job = job;
  }
}
