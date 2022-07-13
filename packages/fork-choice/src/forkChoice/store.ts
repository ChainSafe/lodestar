import {EffectiveBalanceIncrements} from "@lodestar/state-transition";
import {phase0, Slot, RootHex} from "@lodestar/types";
import {toHexString} from "@chainsafe/ssz";
import {CheckpointHexWithBalance, JustifiedBalancesGetter} from "./interface.js";

/**
 * Stores checkpoints in a hybrid format:
 * - Original checkpoint for fast consumption in Lodestar's side
 * - Root in string hex for fast comparisions inside the fork-choice
 */
export type CheckpointWithHex = phase0.Checkpoint & {rootHex: RootHex};

/**
 * Approximates the `Store` in "Ethereum Consensus -- Beacon Chain Fork Choice":
 *
 * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/fork-choice.md#store
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
  justified: CheckpointHexWithBalance;
  bestJustified: CheckpointHexWithBalance;
  finalizedCheckpoint: CheckpointWithHex;
  justifiedBalancesGetter: JustifiedBalancesGetter;
}

/* eslint-disable @typescript-eslint/naming-convention, @typescript-eslint/member-ordering */

/**
 * IForkChoiceStore implementer which emits forkChoice events on updated justified and finalized checkpoints.
 */
export class ForkChoiceStore implements IForkChoiceStore {
  private _justified: CheckpointHexWithBalance;
  bestJustified: CheckpointHexWithBalance;
  private _finalizedCheckpoint: CheckpointWithHex;

  constructor(
    public currentSlot: Slot,
    justifiedCheckpoint: phase0.Checkpoint,
    finalizedCheckpoint: phase0.Checkpoint,
    justifiedBalances: EffectiveBalanceIncrements,
    public justifiedBalancesGetter: JustifiedBalancesGetter,
    private readonly events?: {
      onJustified: (cp: CheckpointWithHex) => void;
      onFinalized: (cp: CheckpointWithHex) => void;
    }
  ) {
    const justified: CheckpointHexWithBalance = {
      checkpoint: toCheckpointWithHex(justifiedCheckpoint),
      balances: justifiedBalances,
    };
    this._justified = justified;
    this.bestJustified = justified;
    this._finalizedCheckpoint = toCheckpointWithHex(finalizedCheckpoint);
  }

  get justified(): CheckpointHexWithBalance {
    return this._justified;
  }

  set justified(justified: CheckpointHexWithBalance) {
    this._justified = justified;
    this.events?.onJustified(justified.checkpoint);
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
  const root = checkpoint.root;
  return {
    epoch: checkpoint.epoch,
    root,
    rootHex: toHexString(root),
  };
}

export function equalCheckpointWithHex(a: CheckpointWithHex, b: CheckpointWithHex): boolean {
  return a.epoch === b.epoch && a.rootHex === b.rootHex;
}
