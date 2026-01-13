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
 * Unique key for indexing ProtoNodes in the fork choice tree
 * Format: "${root}:${payloadStatus}"
 * Used to identify specific variants (PENDING/EMPTY/FULL) of a block
 */
export type ProtoNodeKey = string;

/**
 * Helper to convert ProtoNode to a unique key for indexing
 * Format: "${blockRoot}:${payloadStatus}"
 */
export function protoNodeKey(node: ProtoNode): ProtoNodeKey {
  return `${node.blockRoot}:${node.payloadStatus}`;
}

export function generateProtoNodeKey(root: RootHex, payloadStatus: PayloadStatus): ProtoNodeKey {
  return `${root}:${payloadStatus}`;
}

export type LVHValidResponse = {
  executionStatus: ExecutionStatus.Valid;
  latestValidExecHash: RootHex;
};
export type LVHInvalidResponse = {
  executionStatus: ExecutionStatus.Invalid;
  latestValidExecHash: RootHex | null;
  invalidateFromParentBlockRoot: RootHex;
};
export type LVHExecResponse = LVHValidResponse | LVHInvalidResponse;

export type MaybeValidExecutionStatus = Exclude<ExecutionStatus, ExecutionStatus.Invalid>;

export type BlockExtraMeta =
  | {
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

  /**
   * Parent block hash from SignedExecutionPayloadBid (Gloas fork only)
   * Extracted from: signedExecutionPayloadBid.message.parentBlockHash
   * Used to determine if this block extends EMPTY or FULL parent variant
   * Spec: gloas/fork-choice.md#new-get_parent_payload_status
   */
  parentBlockHash?: RootHex;
};

/**
 * A block root with additional metadata required to form a DAG
 * with vote weights and best blocks stored as metadata
 * 
 * It is also used as ForkChoiceNode in fork choice spec
 */
export type ProtoNode = ProtoBlock & {
  parent?: number;
  /** Payload status for this node (Gloas fork). Always FULL in pre-gloas */
  payloadStatus: PayloadStatus;
  weight: number;
  bestChild?: number;
  bestDescendant?: number;
};
