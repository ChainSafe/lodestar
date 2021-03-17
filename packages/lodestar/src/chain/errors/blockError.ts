import {Root, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {LodestarError} from "@chainsafe/lodestar-utils";

import {IBlockJob, IChainSegmentJob} from "../interface";

export enum BlockErrorCode {
  /**
   * The prestate cannot be fetched
   */
  PRESTATE_MISSING = "BLOCK_ERROR_PRESTATE_MISSING",
  /**
   * The parent block was unknown.
   */
  PARENT_UNKNOWN = "BLOCK_ERROR_PARENT_UNKNOWN",
  /**
   * The block slot is greater than the present slot.
   */
  FUTURE_SLOT = "BLOCK_ERROR_FUTURE_SLOT",
  /**
   * The block state_root does not match the generated state.
   */
  STATE_ROOT_MISMATCH = "BLOCK_ERROR_STATE_ROOT_MISMATCH",
  /**
   * The block was a genesis block, these blocks cannot be re-imported.
   */
  GENESIS_BLOCK = "BLOCK_ERROR_GENESIS_BLOCK",
  /**
   * The slot is finalized, no need to import.
   */
  WOULD_REVERT_FINALIZED_SLOT = "BLOCK_ERROR_WOULD_REVERT_FINALIZED_SLOT",
  /**
   * Block is already known, no need to re-import.
   */
  BLOCK_IS_ALREADY_KNOWN = "BLOCK_ERROR_BLOCK_IS_ALREADY_KNOWN",
  /**
   * A block for this proposer and slot has already been observed.
   */
  REPEAT_PROPOSAL = "BLOCK_ERROR_REPEAT_PROPOSAL",
  /**
   * The block slot exceeds the MAXIMUM_BLOCK_SLOT_NUMBER.
   */
  BLOCK_SLOT_LIMIT_REACHED = "BLOCK_ERROR_BLOCK_SLOT_LIMIT_REACHED",
  /**
   * The `BeaconBlock` has a `proposer_index` that does not match the index we computed locally.
   */
  INCORRECT_PROPOSER = "BLOCK_ERROR_INCORRECT_PROPOSER",
  /**
   * The proposal signature in invalid.
   */
  PROPOSAL_SIGNATURE_INVALID = "BLOCK_ERROR_PROPOSAL_SIGNATURE_INVALID",
  /**
   * The `block.proposer_index` is not known.
   */
  UNKNOWN_PROPOSER = "BLOCK_ERROR_UNKNOWN_PROPOSER",
  /**
   * A signature in the block is invalid (exactly which is unknown).
   */
  INVALID_SIGNATURE = "BLOCK_ERROR_INVALID_SIGNATURE",
  /**
   * The provided block is from an later slot than its parent.
   */
  BLOCK_IS_NOT_LATER_THAN_PARENT = "BLOCK_ERROR_BLOCK_IS_NOT_LATER_THAN_PARENT",
  /**
   * At least one block in the chain segment did not have it's parent root set to the root of the prior block.
   */
  NON_LINEAR_PARENT_ROOTS = "BLOCK_ERROR_NON_LINEAR_PARENT_ROOTS",
  /**
   * The slots of the blocks in the chain segment were not strictly increasing.
   * I.e., a child had lower slot than a parent.
   */
  NON_LINEAR_SLOTS = "BLOCK_ERROR_NON_LINEAR_SLOTS",
  /**
   * The block failed the specification's `per_block_processing` function, it is invalid.
   */
  PER_BLOCK_PROCESSING_ERROR = "BLOCK_ERROR_PER_BLOCK_PROCESSING_ERROR",
  /**
   * There was an error whilst processing the block. It is not necessarily invalid.
   */
  BEACON_CHAIN_ERROR = "BLOCK_ERROR_BEACON_CHAIN_ERROR",
  /**
   * Block did not pass validation during block processing.
   */
  KNOWN_BAD_BLOCK = "BLOCK_ERROR_KNOWN_BAD_BLOCK",
}

export type BlockErrorType =
  | {code: BlockErrorCode.PRESTATE_MISSING}
  | {code: BlockErrorCode.PARENT_UNKNOWN; parentRoot: Root}
  | {code: BlockErrorCode.FUTURE_SLOT; blockSlot: Slot; currentSlot: Slot}
  | {code: BlockErrorCode.STATE_ROOT_MISMATCH}
  | {code: BlockErrorCode.GENESIS_BLOCK}
  | {code: BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT; blockSlot: Slot; finalizedSlot: Slot}
  | {code: BlockErrorCode.BLOCK_IS_ALREADY_KNOWN; root: Root}
  | {code: BlockErrorCode.REPEAT_PROPOSAL; proposer: ValidatorIndex}
  | {code: BlockErrorCode.BLOCK_SLOT_LIMIT_REACHED}
  | {code: BlockErrorCode.INCORRECT_PROPOSER; blockProposer: ValidatorIndex}
  | {code: BlockErrorCode.PROPOSAL_SIGNATURE_INVALID}
  | {code: BlockErrorCode.UNKNOWN_PROPOSER; proposer: ValidatorIndex}
  | {code: BlockErrorCode.INVALID_SIGNATURE}
  | {code: BlockErrorCode.BLOCK_IS_NOT_LATER_THAN_PARENT; blockSlot: Slot; stateSlot: Slot}
  | {code: BlockErrorCode.NON_LINEAR_PARENT_ROOTS}
  | {code: BlockErrorCode.NON_LINEAR_SLOTS}
  | {code: BlockErrorCode.PER_BLOCK_PROCESSING_ERROR; error: Error}
  | {code: BlockErrorCode.BEACON_CHAIN_ERROR; error: Error}
  | {code: BlockErrorCode.KNOWN_BAD_BLOCK};

type BlockJobObject = {
  job: IBlockJob;
};

export class BlockError extends LodestarError<BlockErrorType> {
  job: IBlockJob;

  constructor({job, ...type}: BlockErrorType & BlockJobObject) {
    super(type);
    this.job = job;
  }
}

export type ChainSegmentJobObject = {
  job: IChainSegmentJob;
  importedBlocks: number;
};

export class ChainSegmentError extends LodestarError<BlockErrorType> {
  job: IChainSegmentJob;
  /**
   * Number of blocks successfully imported before the error
   */
  importedBlocks: number;

  constructor({job, importedBlocks, ...type}: BlockErrorType & ChainSegmentJobObject) {
    super(type);
    this.job = job;
    this.importedBlocks = importedBlocks;
  }
}
