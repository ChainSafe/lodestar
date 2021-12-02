import {Epoch, Slot, RootHex} from "@chainsafe/lodestar-types";

// RootHex is a root as a hex string
// Used for lightweight and easy comparison
export const HEX_ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Simplified 'latest message' with previous message
 */
export interface IVoteTracker {
  currentRoot: RootHex;
  nextRoot: RootHex;
  nextEpoch: Epoch;
}

export enum ExecutionStatus {
  Valid = "Valid",
  Syncing = "Syncing",
  PreMerge = "PreMerge",
}

type BlockExecution =
  | {executionPayloadBlockHash: RootHex; executionStatus: ExecutionStatus.Valid | ExecutionStatus.Syncing}
  | {executionPayloadBlockHash: null; executionStatus: ExecutionStatus.PreMerge};
/**
 * A block that is to be applied to the fork choice
 *
 * A simplified version of BeaconBlock
 */

export type IProtoBlock = BlockExecution & {
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
};

/**
 * A block root with additional metadata required to form a DAG
 * with vote weights and best blocks stored as metadata
 */
export type IProtoNode = IProtoBlock & {
  parent?: number;
  weight: number;
  bestChild?: number;
  bestDescendant?: number;
};
