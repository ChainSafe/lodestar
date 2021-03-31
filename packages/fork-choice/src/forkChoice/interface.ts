import {Epoch, Gwei, Slot, ValidatorIndex, phase0, allForks} from "@chainsafe/lodestar-types";
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
  getAncestor(blockRoot: phase0.Root, ancestorSlot: Slot): Uint8Array;
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
  /**
   * Retrieves all possible chain heads (leaves of fork choice tree).
   */
  getHeads(): IBlockSummary[];
  getFinalizedCheckpoint(): phase0.Checkpoint;
  getJustifiedCheckpoint(): phase0.Checkpoint;
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
   *
   * `justifiedBalances` validator balances of justified checkpoint which is updated synchronously.
   * This ensures that the forkchoice is never out of sync.
   */
  onBlock(block: allForks.BeaconBlock, state: allForks.BeaconState, justifiedBalances?: Gwei[]): void;
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
  hasBlock(blockRoot: phase0.Root): boolean;
  /**
   * Returns a `IBlockSummary` if the block is known **and** a descendant of the finalized root.
   */
  getBlock(blockRoot: phase0.Root): IBlockSummary | null;
  getFinalizedBlock(): IBlockSummary;
  /**
   * Return `true` if `block_root` is equal to the finalized root, or a known descendant of it.
   */
  isDescendantOfFinalized(blockRoot: phase0.Root): boolean;
  /**
   * Returns true if the `descendantRoot` has an ancestor with `ancestorRoot`.
   *
   * Always returns `false` if either input roots are unknown.
   * Still returns `true` if `ancestorRoot===descendantRoot` (and the roots are known)
   */
  isDescendant(ancestorRoot: phase0.Root, descendantRoot: phase0.Root): boolean;
  /**
   * Prune items up to a finalized root.
   */
  prune(finalizedRoot: phase0.Root): IBlockSummary[];
  setPruneThreshold(threshold: number): void;
  /**
   * Iterates backwards through block summaries, starting from a block root
   */
  iterateBlockSummaries(blockRoot: phase0.Root): IBlockSummary[];
  /**
   * The same to iterateBlockSummaries but this gets non-ancestor nodes instead of ancestor nodes.
   */
  iterateNonAncestors(blockRoot: phase0.Root): IBlockSummary[];
  getCanonicalBlockSummaryAtSlot(slot: Slot): IBlockSummary | null;
  /**
   * Iterates forwards through block summaries, exact order is not guaranteed
   */
  forwardIterateBlockSummaries(): IBlockSummary[];
  getBlockSummariesByParentRoot(parentRoot: phase0.Root): IBlockSummary[];
  getBlockSummariesAtSlot(slot: Slot): IBlockSummary[];
}

export interface ILatestMessage {
  epoch: Epoch;
  root: phase0.Root;
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
