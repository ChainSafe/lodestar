import {phase0, Slot, RootHex} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";

/**
 * Stores checkpoints in a hybrid format:
 * - Original checkpoint for fast consumption in Lodestar's side
 * - Root in string hex for fast comparisions inside the fork-choice
 */
export type CheckpointWithHex = phase0.Checkpoint & {rootHex: RootHex};

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
  justifiedCheckpoint: CheckpointWithHex;
  finalizedCheckpoint: CheckpointWithHex;
  bestJustifiedCheckpoint: CheckpointWithHex;
}

/* eslint-disable @typescript-eslint/naming-convention */

/**
 * IForkChoiceStore implementer which emits forkChoice events on updated justified and finalized checkpoints.
 */
export class ForkChoiceStore implements IForkChoiceStore {
  bestJustifiedCheckpoint: CheckpointWithHex;
  private _justifiedCheckpoint: CheckpointWithHex;
  private _finalizedCheckpoint: CheckpointWithHex;

  constructor(
    public currentSlot: Slot,
    justifiedCheckpoint: phase0.Checkpoint,
    finalizedCheckpoint: phase0.Checkpoint,
    private readonly events?: {
      onJustified: (cp: CheckpointWithHex) => void;
      onFinalized: (cp: CheckpointWithHex) => void;
    }
  ) {
    this._justifiedCheckpoint = toCheckpointWithHex(justifiedCheckpoint);
    this._finalizedCheckpoint = toCheckpointWithHex(finalizedCheckpoint);
    this.bestJustifiedCheckpoint = this._justifiedCheckpoint;
  }

  get justifiedCheckpoint(): CheckpointWithHex {
    return this._justifiedCheckpoint;
  }

  set justifiedCheckpoint(checkpoint: CheckpointWithHex) {
    const cp = toCheckpointWithHex(checkpoint);
    this._justifiedCheckpoint = cp;
    this.events?.onJustified(cp);
  }

  get finalizedCheckpoint(): CheckpointWithHex {
    return this._finalizedCheckpoint;
  }

  set finalizedCheckpoint(checkpoint: CheckpointWithHex) {
    const cp = toCheckpointWithHex(checkpoint);
    this._finalizedCheckpoint = cp;
    this.events?.onFinalized(cp);
  }
}

export function toCheckpointWithHex(checkpoint: phase0.Checkpoint): CheckpointWithHex {
  // `valueOf` coerses the checkpoint, which may be tree-backed, into a javascript object
  // See https://github.com/ChainSafe/lodestar/issues/2258
  const root = checkpoint.root.valueOf() as Uint8Array;
  return {
    epoch: checkpoint.epoch,
    root,
    rootHex: toHexString(root),
  };
}

export function equalCheckpointWithHex(a: CheckpointWithHex, b: CheckpointWithHex): boolean {
  return a.epoch === b.epoch && a.rootHex === b.rootHex;
}
