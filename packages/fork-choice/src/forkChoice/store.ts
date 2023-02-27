import {EffectiveBalanceIncrements, CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {phase0, Slot, RootHex, ValidatorIndex} from "@lodestar/types";
import {toHexString} from "@chainsafe/ssz";
import {CheckpointHexWithBalance} from "./interface.js";

/**
 * Stores checkpoints in a hybrid format:
 * - Original checkpoint for fast consumption in Lodestar's side
 * - Root in string hex for fast comparisons inside the fork-choice
 */
export type CheckpointWithHex = phase0.Checkpoint & {rootHex: RootHex};

export type JustifiedBalances = EffectiveBalanceIncrements;

/**
 * Returns the justified balances of checkpoint.
 * MUST not throw an error in any case, related to cache miss. Either trigger regen or approximate from a close state.
 * `blockState` is maybe used as a fallback state to get balances since it's very close to desired justified state.
 * @param blockState state that declares justified checkpoint `checkpoint`
 */
export type JustifiedBalancesGetter = (
  checkpoint: CheckpointWithHex,
  blockState: CachedBeaconStateAllForks
) => JustifiedBalances;

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
  unrealizedJustified: CheckpointHexWithBalance;
  finalizedCheckpoint: CheckpointWithHex;
  unrealizedFinalizedCheckpoint: CheckpointWithHex;
  justifiedBalancesGetter: JustifiedBalancesGetter;
  equivocatingIndices: Set<ValidatorIndex>;
}

/**
 * IForkChoiceStore implementer which emits forkChoice events on updated justified and finalized checkpoints.
 */
export class ForkChoiceStore implements IForkChoiceStore {
  private _justified: CheckpointHexWithBalance;
  bestJustified: CheckpointHexWithBalance;
  unrealizedJustified: CheckpointHexWithBalance;
  private _finalizedCheckpoint: CheckpointWithHex;
  unrealizedFinalizedCheckpoint: CheckpointWithHex;
  equivocatingIndices = new Set<ValidatorIndex>();

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
    this.unrealizedJustified = justified;
    this._finalizedCheckpoint = toCheckpointWithHex(finalizedCheckpoint);
    this.unrealizedFinalizedCheckpoint = this._finalizedCheckpoint;
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
