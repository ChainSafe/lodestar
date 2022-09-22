import {EffectiveBalanceIncrements} from "@lodestar/state-transition";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {Epoch, Slot, ValidatorIndex, phase0, allForks, Root, RootHex} from "@lodestar/types";
import {ProtoBlock, MaybeValidExecutionStatus, LVHExecResponse} from "../protoArray/interface.js";
import {CheckpointWithHex} from "./store.js";

export type CheckpointHex = {
  epoch: Epoch;
  root: RootHex;
};

export type CheckpointsWithHex = {
  justifiedCheckpoint: CheckpointWithHex;
  finalizedCheckpoint: CheckpointWithHex;
};

export type CheckpointHexWithBalance = {
  checkpoint: CheckpointWithHex;
  balances: EffectiveBalanceIncrements;
};

export enum EpochDifference {
  current = 0,
  previous = 1,
}

export interface IForkChoice {
  irrecoverableError?: Error;
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
  getHead(): ProtoBlock;
  updateHead(): ProtoBlock;
  /**
   * Retrieves all possible chain heads (leaves of fork choice tree).
   */
  getHeads(): ProtoBlock[];
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
   */
  onBlock(
    block: allForks.BeaconBlock,
    state: CachedBeaconStateAllForks,
    blockDelaySec: number,
    currentSlot: Slot,
    executionStatus: MaybeValidExecutionStatus
  ): void;
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
  onAttestation(attestation: phase0.IndexedAttestation, attDataRoot?: string): void;
  /**
   * Register attester slashing in order not to consider their votes in `getHead`
   *
   * ## Specification
   *
   * https://github.com/ethereum/consensus-specs/blob/v1.2.0-rc.3/specs/phase0/fork-choice.md#on_attester_slashing
   */
  onAttesterSlashing(slashing: phase0.AttesterSlashing): void;
  getLatestMessage(validatorIndex: ValidatorIndex): LatestMessage | undefined;
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
  getSlotsPresent(windowStart: number): number;
  /**
   * Returns a `ProtoBlock` if the block is known **and** a descendant of the finalized root.
   */
  getBlock(blockRoot: Root): ProtoBlock | null;
  getBlockHex(blockRoot: RootHex): ProtoBlock | null;
  getFinalizedBlock(): ProtoBlock;
  getJustifiedBlock(): ProtoBlock;
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
  prune(finalizedRoot: RootHex): ProtoBlock[];
  setPruneThreshold(threshold: number): void;
  /**
   * Iterates backwards through ancestor block summaries, starting from a block root
   */
  iterateAncestorBlocks(blockRoot: RootHex): IterableIterator<ProtoBlock>;
  getAllAncestorBlocks(blockRoot: RootHex): ProtoBlock[];
  /**
   * The same to iterateAncestorBlocks but this gets non-ancestor nodes instead of ancestor nodes.
   */
  getAllNonAncestorBlocks(blockRoot: RootHex): ProtoBlock[];
  getCanonicalBlockAtSlot(slot: Slot): ProtoBlock | null;
  /**
   * Returns all ProtoBlock known to fork-choice. Must not mutated the returned array
   */
  forwarditerateAncestorBlocks(): ProtoBlock[];
  /**
   * Iterates forward descendants of blockRoot. Does not yield blockRoot itself
   */
  forwardIterateDescendants(blockRoot: RootHex): IterableIterator<ProtoBlock>;
  getBlockSummariesByParentRoot(parentRoot: RootHex): ProtoBlock[];
  getBlockSummariesAtSlot(slot: Slot): ProtoBlock[];
  /** Returns the distance of common ancestor of nodes to newNode. Returns null if newNode is descendant of prevNode */
  getCommonAncestorDistance(prevBlock: ProtoBlock, newBlock: ProtoBlock): number | null;
  /**
   * Optimistic sync validate till validated latest hash, invalidate any decendant branch if invalidated branch decendant provided
   */
  validateLatestHash(execResponse: LVHExecResponse): void;

  /**
   * A dependent root is the block root of the last block before the state transition that decided a specific shuffling
   */
  getDependentRoot(block: ProtoBlock, atEpochDiff: EpochDifference): RootHex;
}

/** Same to the PowBlock but we want RootHex to work with forkchoice conveniently */
export type PowBlockHex = {
  blockHash: RootHex;
  parentHash: RootHex;
  totalDifficulty: bigint;
};

export type LatestMessage = {
  epoch: Epoch;
  root: RootHex;
};

/**
 * Used for queuing attestations from the current slot. Only contains the minimum necessary
 * information about the attestation.
 */
export type QueuedAttestation = {
  slot: Slot;
  attestingIndices: ValidatorIndex[];
  blockRoot: RootHex;
  targetEpoch: Epoch;
};
