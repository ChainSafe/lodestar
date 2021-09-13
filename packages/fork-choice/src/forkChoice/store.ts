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

/**
 * IForkChoiceStore implementer which emits forkChoice events on updated justified and finalized checkpoints.
 */
export class ForkChoiceStore implements IForkChoiceStore {
  bestJustifiedCheckpoint: phase0.Checkpoint;
  private _justifiedCheckpoint: phase0.Checkpoint;
  private _finalizedCheckpoint: phase0.Checkpoint;

  constructor(
    public currentSlot: Slot,
    justifiedCheckpoint: phase0.Checkpoint,
    finalizedCheckpoint: phase0.Checkpoint,
    private readonly events?: {
      onJustified: (cp: phase0.Checkpoint) => void;
      onFinalized: (cp: phase0.Checkpoint) => void;
    }
  ) {
    this._justifiedCheckpoint = justifiedCheckpoint;
    this._finalizedCheckpoint = finalizedCheckpoint;
    this.bestJustifiedCheckpoint = this._justifiedCheckpoint;
  }

  get justifiedCheckpoint(): phase0.Checkpoint {
    return this._justifiedCheckpoint;
  }

  set justifiedCheckpoint(cp: phase0.Checkpoint) {
    this._justifiedCheckpoint = cp;
    this.events?.onJustified(cp);
  }

  get finalizedCheckpoint(): phase0.Checkpoint {
    return this._finalizedCheckpoint;
  }

  set finalizedCheckpoint(cp: phase0.Checkpoint) {
    this._finalizedCheckpoint = cp;
    this.events?.onFinalized(cp);
  }
}
