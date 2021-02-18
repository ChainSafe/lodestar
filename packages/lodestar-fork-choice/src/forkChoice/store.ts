import {phase0, Slot} from "@chainsafe/lodestar-types";

/**
 * Approximates the `Store` in "Ethereum 2.0 Phase 0 -- Beacon Chain Fork Choice":
 *
 * https://github.com/ethereum/eth2.0-specs/blob/v0.12.2/specs/phase0/fork-choice.md#store
 *
 * ## Detail
 *
 * This is only an approximation for two reasons:
 *
 * - The actual block DAG in `ProtoArray`.
 * - `time` is represented using `Slot` instead of UNIX epoch `u64`.
 */
export interface IForkChoiceStore {
  currentSlot: Slot;
  justifiedCheckpoint: phase0.Checkpoint;
  finalizedCheckpoint: phase0.Checkpoint;
  bestJustifiedCheckpoint: phase0.Checkpoint;
}
