import {
  BeaconBlock,
  BeaconState,
  Checkpoint,
  Epoch,
  Gwei,
  IndexedAttestation,
  Root,
  Slot,
  ValidatorIndex,
} from "@chainsafe/lodestar-types";
import {IBlockSummary} from "./blockSummary";

export interface IForkChoice {
  /**
   * Returns the block root of an ancestor of `block_root` at the given `slot`. (Note: `slot` refers
   * to the block that is *returned*, not the one that is supplied.)
   *
   * ## Specification
   *
   * Equivalent to:
   *
   * https://github.com/ethereum/eth2.0-specs/blob/v0.12.1/specs/phase0/fork-choice.md#get_ancestor
   */
  getAncestor(blockRoot: Root, ancestorSlot: Slot): Uint8Array;
  /**
   * Run the fork choice rule to determine the head.
   *
   * ## Specification
   *
   * Is equivalent to:
   *
   * https://github.com/ethereum/eth2.0-specs/blob/v0.12.2/specs/phase0/fork-choice.md#get_head
   */
  getHeadRoot(): Uint8Array;
  getHead(): IBlockSummary;
  getFinalizedCheckpoint(): Checkpoint;
  getJustifiedCheckpoint(): Checkpoint;
  /**
   * Add `block` to the fork choice DAG.
   *
   * ## Specification
   *
   * Approximates:
   *
   * https://github.com/ethereum/eth2.0-specs/blob/v0.12.1/specs/phase0/fork-choice.md#on_block
   *
   * It only approximates the specification since it does not run the `state_transition` check.
   * That should have already been called upstream and it's too expensive to call again.
   *
   * ## Notes:
   *
   * The supplied block **must** pass the `state_transition` function as it will not be run here.
   */
  onBlock(block: BeaconBlock, state: BeaconState): void;
  /**
   * Register `attestation` with the fork choice DAG so that it may influence future calls to `getHead`.
   *
   * ## Specification
   *
   * Approximates:
   *
   * https://github.com/ethereum/eth2.0-specs/blob/v0.12.1/specs/phase0/fork-choice.md#on_attestation
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
  onAttestation(attestation: IndexedAttestation): void;
  getLatestMessage(validatorIndex: ValidatorIndex): ILatestMessage | undefined;
  updateBalances(justifiedStateBalances: Gwei[]): void;
  /**
   * Call `onTick` for all slots between `fcStore.getCurrentSlot()` and the provided `currentSlot`.
   */
  updateTime(currentSlot: Slot): void;
  /**
   * Returns `true` if the block is known **and** a descendant of the finalized root.
   */
  hasBlock(blockRoot: Root): boolean;
  /**
   * Returns a `IBlockSummary` if the block is known **and** a descendant of the finalized root.
   */
  getBlock(blockRoot: Root): IBlockSummary | null;
  getFinalizedBlock(): IBlockSummary;
  /**
   * Return `true` if `block_root` is equal to the finalized root, or a known descendant of it.
   */
  isDescendantOfFinalized(blockRoot: Root): boolean;
  /**
   * Returns true if the `descendantRoot` has an ancestor with `ancestorRoot`.
   *
   * Always returns `false` if either input roots are unknown.
   * Still returns `true` if `ancestorRoot===descendantRoot` (and the roots are known)
   */
  isDescendant(ancestorRoot: Root, descendantRoot: Root): boolean;
  prune(): IBlockSummary[];
  setPruneThreshold(threshold: number): void;
  /**
   * Iterates backwards through block summaries, starting from a block root
   */
  iterateBlockSummaries(blockRoot: Root): IBlockSummary[];
  getCanonicalBlockSummaryAtSlot(slot: Slot): IBlockSummary | null;
  /**
   * Iterates forwards through block summaries, exact order is not guaranteed
   */
  forwardIterateBlockSummaries(): IBlockSummary[];
  getBlockSummariesByParentRoot(parentRoot: Root): IBlockSummary[];
  getBlockSummariesAtSlot(slot: Slot): IBlockSummary[];
}

export interface ILatestMessage {
  epoch: Epoch;
  root: Root;
}

/**
 * Used for queuing attestations from the current slot. Only contains the minimum necessary
 * information about the attestation.
 */
export interface IQueuedAttestation {
  slot: Slot;
  attestingIndices: ValidatorIndex[];
  blockRoot: Uint8Array;
  targetEpoch: Epoch;
}
