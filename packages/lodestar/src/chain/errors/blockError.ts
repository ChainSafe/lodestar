import {allForks, RootHex, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {LodestarError} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {CachedBeaconStateAllForks} from "@chainsafe/lodestar-beacon-state-transition";
import {GossipActionError} from "./gossipValidation";
import {ExecutePayloadStatus} from "../../executionEngine/interface";

export enum BlockErrorCode {
  /** The prestate cannot be fetched */
  PRESTATE_MISSING = "BLOCK_ERROR_PRESTATE_MISSING",
  /** The parent block was unknown. */
  PARENT_UNKNOWN = "BLOCK_ERROR_PARENT_UNKNOWN",
  /** The block slot is greater than the present slot. */
  FUTURE_SLOT = "BLOCK_ERROR_FUTURE_SLOT",
  /** The block state_root does not match the generated state. */
  STATE_ROOT_MISMATCH = "BLOCK_ERROR_STATE_ROOT_MISMATCH",
  /** The block was a genesis block, these blocks cannot be re-imported. */
  GENESIS_BLOCK = "BLOCK_ERROR_GENESIS_BLOCK",
  /** The slot is finalized, no need to import. */
  WOULD_REVERT_FINALIZED_SLOT = "BLOCK_ERROR_WOULD_REVERT_FINALIZED_SLOT",
  /** Block is already known, no need to re-import. */
  ALREADY_KNOWN = "BLOCK_ERROR_ALREADY_KNOWN",
  /** A block for this proposer and slot has already been observed. */
  REPEAT_PROPOSAL = "BLOCK_ERROR_REPEAT_PROPOSAL",
  /** The block slot exceeds the MAXIMUM_BLOCK_SLOT_NUMBER. */
  BLOCK_SLOT_LIMIT_REACHED = "BLOCK_ERROR_BLOCK_SLOT_LIMIT_REACHED",
  /** The `BeaconBlock` has a `proposer_index` that does not match the index we computed locally. */
  INCORRECT_PROPOSER = "BLOCK_ERROR_INCORRECT_PROPOSER",
  /** The proposal signature in invalid. */
  PROPOSAL_SIGNATURE_INVALID = "BLOCK_ERROR_PROPOSAL_SIGNATURE_INVALID",
  /** The `block.proposer_index` is not known. */
  UNKNOWN_PROPOSER = "BLOCK_ERROR_UNKNOWN_PROPOSER",
  /** A signature in the block is invalid (exactly which is unknown). */
  INVALID_SIGNATURE = "BLOCK_ERROR_INVALID_SIGNATURE",
  /** Block transition returns invalid state root. */
  INVALID_STATE_ROOT = "BLOCK_ERROR_INVALID_STATE_ROOT",
  /** Block (its parent) is not a descendant of current finalized block */
  NOT_FINALIZED_DESCENDANT = "BLOCK_ERROR_NOT_FINALIZED_DESCENDANT",
  /** The provided block is from an later slot than its parent. */
  NOT_LATER_THAN_PARENT = "BLOCK_ERROR_NOT_LATER_THAN_PARENT",
  /** At least one block in the chain segment did not have it's parent root set to the root of the prior block. */
  NON_LINEAR_PARENT_ROOTS = "BLOCK_ERROR_NON_LINEAR_PARENT_ROOTS",
  /** The slots of the blocks in the chain segment were not strictly increasing. */
  NON_LINEAR_SLOTS = "BLOCK_ERROR_NON_LINEAR_SLOTS",
  /** The block failed the specification's `per_block_processing` function, it is invalid. */
  PER_BLOCK_PROCESSING_ERROR = "BLOCK_ERROR_PER_BLOCK_PROCESSING_ERROR",
  /** There was an error whilst processing the block. It is not necessarily invalid. */
  BEACON_CHAIN_ERROR = "BLOCK_ERROR_BEACON_CHAIN_ERROR",
  /** Block did not pass validation during block processing. */
  KNOWN_BAD_BLOCK = "BLOCK_ERROR_KNOWN_BAD_BLOCK",
  // Merge p2p
  /** executionPayload.timestamp is not the expected value */
  INCORRECT_TIMESTAMP = "BLOCK_ERROR_INCORRECT_TIMESTAMP",
  /** executionPayload.gasUsed > executionPayload.gasLimit */
  TOO_MUCH_GAS_USED = "BLOCK_ERROR_TOO_MUCH_GAS_USED",
  /** executionPayload.blockHash == executionPayload.parentHash */
  SAME_PARENT_HASH = "BLOCK_ERROR_SAME_PARENT_HASH",
  /** Total size of executionPayload.transactions exceed a sane limit to prevent DOS attacks */
  TRANSACTIONS_TOO_BIG = "BLOCK_ERROR_TRANSACTIONS_TOO_BIG",
  /** Execution engine is unavailable, syncing, or api call errored. Peers must not be downscored on this code */
  EXECUTION_ENGINE_ERROR = "BLOCK_ERROR_EXECUTION_ERROR",
}

type ExecutionErrorStatus = Exclude<
  ExecutePayloadStatus,
  ExecutePayloadStatus.VALID | ExecutePayloadStatus.ACCEPTED | ExecutePayloadStatus.SYNCING
>;

export type BlockErrorType =
  | {code: BlockErrorCode.PRESTATE_MISSING; error: Error}
  | {code: BlockErrorCode.PARENT_UNKNOWN; parentRoot: RootHex}
  | {code: BlockErrorCode.FUTURE_SLOT; blockSlot: Slot; currentSlot: Slot}
  | {code: BlockErrorCode.STATE_ROOT_MISMATCH}
  | {code: BlockErrorCode.GENESIS_BLOCK}
  | {code: BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT; blockSlot: Slot; finalizedSlot: Slot}
  | {code: BlockErrorCode.ALREADY_KNOWN; root: RootHex}
  | {code: BlockErrorCode.REPEAT_PROPOSAL; proposerIndex: ValidatorIndex}
  | {code: BlockErrorCode.BLOCK_SLOT_LIMIT_REACHED}
  | {code: BlockErrorCode.INCORRECT_PROPOSER; proposerIndex: ValidatorIndex}
  | {code: BlockErrorCode.PROPOSAL_SIGNATURE_INVALID}
  | {code: BlockErrorCode.UNKNOWN_PROPOSER; proposerIndex: ValidatorIndex}
  | {code: BlockErrorCode.INVALID_SIGNATURE; state: CachedBeaconStateAllForks}
  | {
      code: BlockErrorCode.INVALID_STATE_ROOT;
      root: Uint8Array;
      expectedRoot: Uint8Array;
      preState: CachedBeaconStateAllForks;
      postState: CachedBeaconStateAllForks;
    }
  | {code: BlockErrorCode.NOT_FINALIZED_DESCENDANT; parentRoot: RootHex}
  | {code: BlockErrorCode.NOT_LATER_THAN_PARENT; parentSlot: Slot; slot: Slot}
  | {code: BlockErrorCode.NON_LINEAR_PARENT_ROOTS}
  | {code: BlockErrorCode.NON_LINEAR_SLOTS}
  | {code: BlockErrorCode.PER_BLOCK_PROCESSING_ERROR; error: Error}
  | {code: BlockErrorCode.BEACON_CHAIN_ERROR; error: Error}
  | {code: BlockErrorCode.KNOWN_BAD_BLOCK}
  | {code: BlockErrorCode.INCORRECT_TIMESTAMP; timestamp: number; expectedTimestamp: number}
  | {code: BlockErrorCode.TOO_MUCH_GAS_USED; gasUsed: number; gasLimit: number}
  | {code: BlockErrorCode.SAME_PARENT_HASH; blockHash: RootHex}
  | {code: BlockErrorCode.TRANSACTIONS_TOO_BIG; size: number; max: number}
  | {code: BlockErrorCode.EXECUTION_ENGINE_ERROR; execStatus: ExecutionErrorStatus; errorMessage: string};

export class BlockGossipError extends GossipActionError<BlockErrorType> {}

export class BlockError extends LodestarError<BlockErrorType> {
  constructor(readonly signedBlock: allForks.SignedBeaconBlock, type: BlockErrorType) {
    super(type);
  }

  getMetadata(): Record<string, string | number | null> {
    return renderBlockErrorType(this.type);
  }
}

export class ChainSegmentError extends LodestarError<BlockErrorType> {
  /**
   * Number of blocks successfully imported before the error
   */
  importedBlocks: number;

  constructor(readonly signedBlock: allForks.SignedBeaconBlock, type: BlockErrorType, importedBlocks: number) {
    super(type);
    this.importedBlocks = importedBlocks;
  }

  getMetadata(): Record<string, string | number | null> {
    return renderBlockErrorType(this.type);
  }
}

export function renderBlockErrorType(type: BlockErrorType): Record<string, string | number | null> {
  switch (type.code) {
    case BlockErrorCode.PRESTATE_MISSING:
    case BlockErrorCode.PER_BLOCK_PROCESSING_ERROR:
    case BlockErrorCode.BEACON_CHAIN_ERROR:
      return {
        error: type.error.message,
      };

    case BlockErrorCode.INVALID_SIGNATURE:
      return {};

    case BlockErrorCode.INVALID_STATE_ROOT:
      return {
        root: toHexString(type.root),
        expectedRoot: toHexString(type.expectedRoot),
      };

    default:
      return type;
  }
}
