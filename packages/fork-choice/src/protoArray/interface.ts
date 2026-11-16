import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot, UintNum64, ValidatorIndex} from "@lodestar/types";

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
 * Bid fields of a gloas block, see `BlockBidMeta`
 */
export type GloasBlockBidMeta = {
  // `parent_block_hash` of the block's bid. This is the execution block hash the block builds on,
  // reported to the execution engine while the block's own payload is not imported
  parentBlockHash: RootHex;

  // `parent_payload_root` of the block's bid
  // Used to determine if this block extends EMPTY or FULL parent variant
  // Spec: gloas/fork-choice.md#new-get_parent_payload_status
  parentPayloadRoot: RootHex;

  // `payload_root` of the block's bid. Same for all variants of the block, it becomes the
  // executionPayloadRoot of the FULL variant once the payload is imported. Do not use it to look up the
  // payload a child builds on, the FULL variant may not exist: use executionPayloadRoot of the variants
  payloadRoot: RootHex;
};

/**
 * The fields that come from the block's bid: all set for a gloas block, all null for a pre-gloas block.
 * A block with only some of them set is not a valid `ProtoBlock`, `ProtoArray.onBlock` throws on it.
 */
export type BlockBidMeta = GloasBlockBidMeta | {parentBlockHash: null; parentPayloadRoot: null; payloadRoot: null};

/**
 * Check if a block is in the Gloas fork (ePBS enabled)
 *
 * `parentBlockHash`, `parentPayloadRoot` and `payloadRoot` come from the block's bid, so they are either all
 * set (gloas) or all null (pre-gloas). `ProtoArray.onBlock` enforces it for every node it holds.
 */
export function isGloasBlock(block: ProtoBlock): block is ProtoBlock & GloasBlockBidMeta {
  return block.parentBlockHash !== null;
}

/**
 * What the parent of a block or bid has to offer for the payload they build on (`bid.parent_payload_root`),
 * see `ProtoArray.getParentPayloadDependency`
 */
export enum ParentPayloadDependency {
  /** The parent block is not in fork choice */
  UnknownBlock = "unknown_block",
  /** A variant of the parent carries the payload, the block can be imported on top of it */
  Ready = "ready",
  /**
   * The payload may be the one of the parent block, which is not imported. This is certain for a block whose
   * bid fork choice knows, and the only option left for a placeholder
   */
  AwaitingPayload = "awaiting_payload",
  /**
   * The payload is neither the one of the parent block nor the one the parent block builds on, no valid block
   * names it. Never returned for a placeholder, fork choice does not know its bid.
   */
  Invalid = "invalid",
}

export type LVHValidResponse = {
  executionStatus: ExecutionStatus.Valid;
  latestValidExecHash: RootHex;
  /** Resolves the exact node to validate when several nodes carry the same payload hash (gloas variants) */
  blockRoot?: RootHex;
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
      // Hash tree root of the execution payload identified by executionPayloadBlockHash, with the same
      // semantics for each variant. Bids commit to the payload they build on by this root
      // (`bid.parent_payload_root`), so this is what decides which variant a block or bid builds on,
      // executionPayloadBlockHash is for the execution engine
      executionPayloadRoot: RootHex;
      executionPayloadNumber: UintNum64;
      // Gas limit of the executed payload identified by executionPayloadBlockHash. Set on
      // pre-Gloas blocks (from block.body.executionPayload.gasLimit) and on Gloas variants:
      //   - PENDING/EMPTY: inherited from the parent payload that the bid commits to extend
      //     (matches executionPayloadBlockHash, which also points to that parent payload)
      //   - FULL: the actual delivered payload's gasLimit (set in onExecutionPayload)
      // Consumers (e.g. Gloas bid gas-limit validation) can read this without re-deriving from
      // state.
      executionPayloadGasLimit: UintNum64;
      executionStatus: Exclude<ExecutionStatus, ExecutionStatus.PreMerge>;
      dataAvailabilityStatus: DataAvailabilityStatus;
    }
  | {
      executionPayloadBlockHash: null;
      executionPayloadRoot: null;
      executionStatus: ExecutionStatus.PreMerge;
      dataAvailabilityStatus: DataAvailabilityStatus.PreData;
    };

/** The execution payload fields and the bid fields of a block, both discriminated on the fork of the block */
type BlockMeta = BlockExtraMeta & BlockBidMeta;

/**
 * A block that is to be applied to the fork choice
 *
 * A simplified version of BeaconBlock
 */

export type ProtoBlock = BlockMeta & {
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

  // Indicate whether block arrives before the PTC deadline
  // Spec: gloas/fork-choice.md#modified-record_block_timeliness (block_timeliness[PTC_TIMELINESS_INDEX])
  ptcTimeliness: boolean;

  // Indicate whether THIS node finished importing the block before the attestation cutoff
  importedTimely: boolean;

  // The index of the block proposer. Used by should_apply_proposer_boost to detect proposer equivocations
  proposerIndex: ValidatorIndex;

  /** Payload status for this node (Gloas fork). Always FULL in pre-gloas */
  payloadStatus: PayloadStatus;

  /**
   * Set on a node that stands in for a block of which fork choice only knows the root: the ancestors of the
   * anchor block (parent, justified and finalized) when fork choice starts from an unfinalized state.
   * Only `blockRoot` is the one of the block. `slot` is an upper bound, `parentRoot` links to the next
   * placeholder and not to the parent of the block, and `stateRoot`, the bid fields and the execution payload
   * fields are not those of the block. Nothing may be concluded about a block or an envelope from these fields,
   * in particular a mismatch with them is never a fault of a peer.
   */
  isPlaceholder?: boolean;
};

/**
 * A block root with additional metadata required to form a DAG
 * with vote weights and best blocks stored as metadata
 *
 * It is also used as ForkChoiceNode in fork choice spec
 */
export type ProtoNode = ProtoBlock & {
  parent?: number;
  /** Total weight in Gwei, ie. attestationScore plus the proposer boost credited to this node */
  weight: bigint;
  /**
   * Weight in Gwei from attester votes only, excluding proposer boost.
   * Spec: get_attestation_score
   */
  attestationScore: bigint;
  bestChild?: number;
  bestDescendant?: number;
};

/**
 * PTC majority per PayloadAttestationData field: `true` or `false` once more than PTC_SIZE // 2
 * members voted that way, `null` while neither outcome has a majority.
 */
export type PtcQuorum = {
  payloadPresent: boolean | null;
  blobDataAvailable: boolean | null;
};

/**
 * The PTC verdict fork choice acts on: `false` once either field has a majority against the
 * payload, `true` once both have a majority for it, `null` while undecided. A single majority
 * against is final on its own because should_extend_payload needs both in favour and
 * should_build_on_full moves the proposer onto EMPTY on either.
 */
export function getPtcVerdict({payloadPresent, blobDataAvailable}: PtcQuorum): boolean | null {
  if (payloadPresent === false || blobDataAvailable === false) return false;
  if (payloadPresent === true && blobDataAvailable === true) return true;
  return null;
}
