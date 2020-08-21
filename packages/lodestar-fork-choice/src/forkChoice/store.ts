import {Checkpoint, Gwei, Slot, BeaconBlock, BeaconState} from "@chainsafe/lodestar-types";

/**
 * Approximates the `Store` in "Ethereum 2.0 Phase 0 -- Beacon Chain Fork Choice":
 *
 * https://github.com/ethereum/eth2.0-specs/blob/v0.12.2/specs/phase0/fork-choice.md#store
 *
 * ## Detail
 *
 * This is only an approximation for two reasons:
 *
 * - The actual block DAG in `ProtoArrayForkChoice`.
 * - `time` is represented using `Slot` instead of UNIX epoch `u64`.
 *
 * ## Motiviation
 *
 * The primary motivation for defining this as an interface to be implemented upstream rather than a
 * concrete struct is to allow this crate to be free from "impure" on-disk database logic,
 * hopefully making auditing easier.
 */
export interface IForkChoiceStore {
  currentSlot: Slot;
  justifiedCheckpoint: Checkpoint;
  bestJustifiedCheckpoint: Checkpoint;
  finalizedCheckpoint: Checkpoint;

  /**
   * Called whenever `ForkChoice::on_block` has verified a block, but not yet added it to fork choice.
   * Allows the implementer to performing caching or other housekeeping duties.
   */
  onVerifiedBlock(block: BeaconBlock, state: BeaconState): void;

  /**
   * Returns balances from the `state` identified by `justified_checkpoint.root`.
   */
  justifiedBalances(): Gwei[];
}
