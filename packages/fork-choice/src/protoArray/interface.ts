import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot, UintNum64} from "@lodestar/types";

// RootHex is a root as a hex string
// Used for lightweight and easy comparison
export const HEX_ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * The null vote index indicates that a validator votes to a non-existent block. This usually happens when
 * we prune the proto array and the validator's latest message is in the pruned part.
 * The number of proto nodes will never exceed this value because it represents (0xffffffff / 365 / 24 / 60 / 5), ie > 1634 years of non-finalized network.
 */
export const NULL_VOTE_INDEX = 0xffffffff;

/**
 * A vote index is a non-negative integer from 0 to NULL_VOTE_INDEX inclusive, and it will never be undefined.
 */
export type VoteIndex = number;

/**
 * Execution status of a block in fork choice.
 *
 * - Valid: Execution payload verified as valid by the EL
 * - Syncing: EL is syncing, payload validity unknown (optimistic sync)
 * - PreMerge: Block is from before The Merge, no execution payload exists
 * - Invalid: Execution payload was invalidated by the EL (post-import status)
 *
 * For gloas blocks the PENDING/EMPTY variants inherit `executionStatus` from the parent's chain
 * (Valid/Syncing/PreMerge); the FULL variant carries the EL response for this block's own payload.
 */
export enum ExecutionStatus {
  Valid = "Valid",
  Syncing = "Syncing",
  PreMerge = "PreMerge",
  Invalid = "Invalid",
}

/**
 * Payload status for ePBS (Gloas fork)
 * Spec: gloas/fork-choice.md#constants
 */
export enum PayloadStatus {
  PENDING = 0,
  EMPTY = 1,
  FULL = 2,
}

/**
 * Check if a block is in the Gloas fork (ePBS enabled)
 */
export function isGloasBlock(block: ProtoBlock): boolean {
  return block.parentBlockHash !== null;
}

export type LVHValidResponse = {
  executionStatus: ExecutionStatus.Valid;
  latestValidExecHash: RootHex;
};
export type LVHInvalidResponse = {
  executionStatus: ExecutionStatus.Invalid;
  latestValidExecHash: RootHex | null;
  invalidateFromParentBlockRoot: RootHex;
  // EL block hash from invalid block's bid (gloas) or payload's parentHash (pre-gloas).
  // Disambiguates which variant of the parent (FULL vs EMPTY) to invalidate from.
  invalidateFromParentBlockHash: RootHex;
};
export type LVHExecResponse = LVHValidResponse | LVHInvalidResponse;

/**
 * Any execution status that is not definitively invalid.
 * Valid | Syncing | PreMerge
 */
export type BlockExecutionStatus = Exclude<ExecutionStatus, ExecutionStatus.Invalid>;

/**
 * Execution status for a block whose execution payload is present and has been submitted to the EL.
 * Used post-Gloas when transitioning a PENDING block to FULL via onExecutionPayload().
 */
export type PayloadExecutionStatus = ExecutionStatus.Valid | ExecutionStatus.Syncing;

export type BlockExtraMeta =
  | {
      // Pre-gloas:
      //   - block hash of payload of the block
      // Post-gloas:
      //   - this is parentBlockHash of block bid because payload is only received later
      //   - payload block hash for FULL variant
      executionPayloadBlockHash: RootHex;
      executionPayloadNumber: UintNum64;
      executionStatus: Exclude<ExecutionStatus, ExecutionStatus.PreMerge>;
      dataAvailabilityStatus: DataAvailabilityStatus;
    }
  | {
      executionPayloadBlockHash: null;
      executionStatus: ExecutionStatus.PreMerge;
      dataAvailabilityStatus: DataAvailabilityStatus.PreData;
    };

/**
 * A block that is to be applied to the fork choice
 *
 * A simplified version of BeaconBlock
 */

export type ProtoBlock = BlockExtraMeta & {
  /**
   * The slot is not necessary for ProtoArray,
   * it just exists so external components can easily query the block slot.
   * This is useful for upstream fork choice logic.
   */
  slot: Slot;
  blockRoot: RootHex;
  parentRoot: RootHex;
  /**
   * The stateRoot is not necessary for ProtoArray either,
   * it also just exists for upstream components (namely attestation verification)
   */
  stateRoot: RootHex;
  /**
   * The root that would be used for the attestation.data.target.root if a LMD vote was cast for this block.
   *
   * The targetRoot is not necessary for ProtoArray either,
   * it also just exists for upstream components (namely attestation verification)
   */
  targetRoot: RootHex;

  justifiedEpoch: Epoch;
  justifiedRoot: RootHex;
  finalizedEpoch: Epoch;
  finalizedRoot: RootHex;
  unrealizedJustifiedEpoch: Epoch;
  unrealizedJustifiedRoot: RootHex;
  unrealizedFinalizedEpoch: Epoch;
  unrealizedFinalizedRoot: RootHex;

  // Indicate whether block arrives in a timely manner ie. before the 4 second mark
  timeliness: boolean;

  // Indicate whether HEZE is enabled
  isHezeEnabled: boolean;

  /** Payload status for this node (Gloas fork). Always FULL in pre-gloas */
  payloadStatus: PayloadStatus;

  // Used to determine if this block extends EMPTY or FULL parent variant
  // Spec: gloas/fork-choice.md#new-get_parent_payload_status
  parentBlockHash: RootHex | null;
};

/**
 * A block root with additional metadata required to form a DAG
 * with vote weights and best blocks stored as metadata
 *
 * It is also used as ForkChoiceNode in fork choice spec
 */
export type ProtoNode = ProtoBlock & {
  parent?: number;
  weight: number;
  bestChild?: number;
  bestDescendant?: number;
};
