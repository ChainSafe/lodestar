import {EffectiveBalanceIncrements} from "@chainsafe/lodestar-beacon-state-transition";
import {BeaconStateAllForks} from "@chainsafe/lodestar-beacon-state-transition";
import {Epoch, Slot, ValidatorIndex, phase0, allForks, Root, RootHex} from "@chainsafe/lodestar-types";
import {IProtoBlock, ExecutionStatus} from "../protoArray/interface.js";
import {CheckpointWithHex} from "./store.js";

export type CheckpointHex = {
  epoch: Epoch;
  root: RootHex;
};

export interface IForkChoice {
  /**
   * Returns the block root of an ancestor of `block_root` at the given `slot`. (Note: `slot` refers
   * to the block that is *returned*, not the one that is supplied.)
   *
   * ## Specification
   *
   * Equivalent to:
   *
   * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/fork-choice.md#get_ancestor
   */
  getAncestor(blockRoot: RootHex, ancestorSlot: Slot): RootHex;
  /**
   * Run the fork choice rule to determine the head.
   *
   * ## Specification
   *
   * Is equivalent to:
   *
   * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/fork-choice.md#get_head
   */
  getHeadRoot(): RootHex;
  getHead(): IProtoBlock;
  updateHead(): IProtoBlock;
  /**
   * Retrieves all possible chain heads (leaves of fork choice tree).
   */
  getHeads(): IProtoBlock[];
  getFinalizedCheckpoint(): CheckpointWithHex;
  getJustifiedCheckpoint(): CheckpointWithHex;
  /**
   * Add `block` to the fork choice DAG.
   *
   * ## Specification
   *
   * Approximates:
   *
   * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/fork-choice.md#on_block
   *
   * It only approximates the specification since it does not run the `state_transition` check.
   * That should have already been called upstream and it's too expensive to call again.
   *
   * ## Notes:
   *
   * The supplied block **must** pass the `state_transition` function as it will not be run here.
   *
   * `preCachedData` includes data necessary for validation included in the spec but some data is
   * pre-fetched in advance to keep the fork-choice fully syncronous
   */
  onBlock(block: allForks.BeaconBlock, state: BeaconStateAllForks, preCachedData?: OnBlockPrecachedData): void;
  /**
   * Register `attestation` with the fork choice DAG so that it may influence future calls to `getHead`.
   *
   * ## Specification
   *
   * Approximates:
   *
   * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/fork-choice.md#on_attestation
   *
   * It only approximates the specification since it does not perform
   * `is_valid_indexed_attestation` since that should already have been called upstream and it's
   * too expensive to call again.
   *
   * ## Notes:
   *
   * The supplied `attestation` **must** pass the `in_valid_indexed_attestation` function as it
   * will not be run here.
   */
  onAttestation(attestation: phase0.IndexedAttestation): void;
  getLatestMessage(validatorIndex: ValidatorIndex): ILatestMessage | undefined;
  /**
   * Call `onTick` for all slots between `fcStore.getCurrentSlot()` and the provided `currentSlot`.
   */
  updateTime(currentSlot: Slot): void;

  /**
   * Returns current time slot.
   */
  getTime(): Slot;
  /**
   * Returns `true` if the block is known **and** a descendant of the finalized root.
   */
  hasBlock(blockRoot: Root): boolean;
  hasBlockHex(blockRoot: RootHex): boolean;
  /**
   * Returns a `IProtoBlock` if the block is known **and** a descendant of the finalized root.
   */
  getBlock(blockRoot: Root): IProtoBlock | null;
  getBlockHex(blockRoot: RootHex): IProtoBlock | null;
  getFinalizedBlock(): IProtoBlock;
  getJustifiedBlock(): IProtoBlock;
  /**
   * Return `true` if `block_root` is equal to the finalized root, or a known descendant of it.
   */
  isDescendantOfFinalized(blockRoot: RootHex): boolean;
  /**
   * Returns true if the `descendantRoot` has an ancestor with `ancestorRoot`.
   *
   * Always returns `false` if either input roots are unknown.
   * Still returns `true` if `ancestorRoot===descendantRoot` (and the roots are known)
   */
  isDescendant(ancestorRoot: RootHex, descendantRoot: RootHex): boolean;
  /**
   * Prune items up to a finalized root.
   */
  prune(finalizedRoot: RootHex): IProtoBlock[];
  setPruneThreshold(threshold: number): void;
  /**
   * Iterates backwards through ancestor block summaries, starting from a block root
   */
  iterateAncestorBlocks(blockRoot: RootHex): IterableIterator<IProtoBlock>;
  getAllAncestorBlocks(blockRoot: RootHex): IProtoBlock[];
  /**
   * The same to iterateAncestorBlocks but this gets non-ancestor nodes instead of ancestor nodes.
   */
  getAllNonAncestorBlocks(blockRoot: RootHex): IProtoBlock[];
  getCanonicalBlockAtSlot(slot: Slot): IProtoBlock | null;
  /**
   * Iterates forwards through block summaries, exact order is not guaranteed
   */
  forwarditerateAncestorBlocks(): IProtoBlock[];
  getBlockSummariesByParentRoot(parentRoot: RootHex): IProtoBlock[];
  getBlockSummariesAtSlot(slot: Slot): IProtoBlock[];
  /** Returns the distance of common ancestor of nodes to newNode. Returns null if newNode is descendant of prevNode */
  getCommonAncestorDistance(prevBlock: IProtoBlock, newBlock: IProtoBlock): number | null;
  /**
   * Optimistic sync validate till validated latest hash, invalidate any decendant branch if invalidated branch decendant provided
   */
  validateLatestHash(latestValidHash: RootHex, invalidateTillHash: RootHex | null): void;
}

/** Same to the PowBlock but we want RootHex to work with forkchoice conveniently */
export type PowBlockHex = {
  blockhash: RootHex;
  parentHash: RootHex;
  totalDifficulty: bigint;
};

export type OnBlockPrecachedData = {
  /** `justifiedBalances` balances of justified state which is updated synchronously. */
  justifiedBalances?: EffectiveBalanceIncrements;
  /** Time in seconds when the block was received */
  blockDelaySec: number;
  /**
   * POW chain block parent, from getPowBlock() `eth_getBlockByHash` JSON RPC endpoint
   * ```ts
   * powBlock = getPowBlock((block as bellatrix.BeaconBlock).body.executionPayload.parentHash)
   * ```
   */
  powBlock?: PowBlockHex | null;
  /**
   * POW chain block's block parent, from getPowBlock() `eth_getBlockByHash` JSON RPC endpoint
   * ```ts
   * const powParent = getPowBlock(powBlock.parentHash);
   * ```
   */
  powBlockParent?: PowBlockHex | null;
  /**
   * Optimistic sync fields
   */
  isMergeTransitionBlock?: boolean;
  executionStatus?: ExecutionStatus;
};

export interface ILatestMessage {
  epoch: Epoch;
  root: RootHex;
}

/**
 * Used for queuing attestations from the current slot. Only contains the minimum necessary
 * information about the attestation.
 */
export interface IQueuedAttestation {
  slot: Slot;
  attestingIndices: ValidatorIndex[];
  blockRoot: RootHex;
  targetEpoch: Epoch;
}
