import {EffectiveBalanceIncrements, IBeaconStateView} from "@lodestar/state-transition";
import {RootHex, Slot, ValidatorIndex, phase0} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ForkChoiceStateGetter, IFastConfirmationStore} from "./fastConfirmation/types.ts";
import {CheckpointWithBalance, CheckpointWithTotalBalance} from "./interface.js";

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
  blockState: IBeaconStateView
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
export interface IForkChoiceStore extends IFastConfirmationStore {
  currentSlot: Slot;
  get justified(): CheckpointWithTotalBalance;
  set justified(justified: CheckpointWithBalance);
  unrealizedJustified: CheckpointWithBalance;
  finalizedCheckpoint: CheckpointWithHex;
  unrealizedFinalizedCheckpoint: CheckpointWithHex;
  justifiedBalancesGetter: JustifiedBalancesGetter;
  equivocatingIndices: Set<ValidatorIndex>;
  notifyFastConfirmation?(data: {block: RootHex; slot: Slot; currentSlot: Slot}): void;
}

/**
 * IForkChoiceStore implementer which emits forkChoice events on updated justified and finalized checkpoints.
 */
export class ForkChoiceStore implements IForkChoiceStore {
  private _justified: CheckpointWithTotalBalance;
  unrealizedJustified: CheckpointWithBalance;
  private _finalizedCheckpoint: CheckpointWithHex;
  unrealizedFinalizedCheckpoint: CheckpointWithHex;
  equivocatingIndices = new Set<ValidatorIndex>();
  justifiedBalancesGetter: JustifiedBalancesGetter;
  currentSlot: Slot;

  // Fast Confirmation Rule spec fields
  confirmedRoot: RootHex;
  previousEpochObservedJustifiedCheckpoint: CheckpointWithHex;
  currentEpochObservedJustifiedCheckpoint: CheckpointWithHex;
  previousEpochGreatestUnrealizedCheckpoint: CheckpointWithHex;
  previousSlotHead: RootHex;
  currentSlotHead: RootHex;

  // Fast Confirmation Rule internal fields
  previousEpochObservedJustifiedBalances: JustifiedBalances;
  currentEpochObservedJustifiedBalances: JustifiedBalances;
  previousEpochGreatestUnrealizedBalances: JustifiedBalances;
  stateGetter: ForkChoiceStateGetter;

  constructor(
    currentSlot: Slot,
    justifiedCheckpoint: phase0.Checkpoint,
    finalizedCheckpoint: phase0.Checkpoint,
    justifiedBalances: EffectiveBalanceIncrements,
    justifiedBalancesGetter: JustifiedBalancesGetter,
    stateGetter: ForkChoiceStateGetter,
    private readonly events?: {
      onJustified: (cp: CheckpointWithHex) => void;
      onFinalized: (cp: CheckpointWithHex) => void;
      onFastConfirmation?: (data: {block: RootHex; slot: Slot; currentSlot: Slot}) => void;
    }
  ) {
    this.justifiedBalancesGetter = justifiedBalancesGetter;
    this.currentSlot = currentSlot;
    this.stateGetter = stateGetter;
    const justified = {
      checkpoint: toCheckpointWithHex(justifiedCheckpoint),
      balances: justifiedBalances,
      totalBalance: computeTotalBalance(justifiedBalances),
    };
    this._justified = justified;
    this.unrealizedJustified = justified;
    this._finalizedCheckpoint = toCheckpointWithHex(finalizedCheckpoint);
    this.unrealizedFinalizedCheckpoint = this._finalizedCheckpoint;

    // Initialize Fast Confirmation fields conservatively from finalized, matching
    // the spec's get_fast_confirmation_store() behavior.
    const finalizedCheckpointWithHex = toCheckpointWithHex(finalizedCheckpoint);
    const finalizedState = stateGetter({checkpoint: finalizedCheckpointWithHex});
    const finalizedBalances = finalizedState?.effectiveBalanceIncrements ?? justifiedBalances;
    const anchorRoot = finalizedCheckpointWithHex.rootHex;
    this.previousEpochObservedJustifiedCheckpoint = finalizedCheckpointWithHex;
    this.currentEpochObservedJustifiedCheckpoint = finalizedCheckpointWithHex;
    this.previousEpochGreatestUnrealizedCheckpoint = finalizedCheckpointWithHex;
    this.confirmedRoot = anchorRoot;
    this.previousEpochObservedJustifiedBalances = finalizedBalances;
    this.currentEpochObservedJustifiedBalances = finalizedBalances;
    this.previousEpochGreatestUnrealizedBalances = finalizedBalances;
    this.previousSlotHead = anchorRoot;
    this.currentSlotHead = anchorRoot;
  }

  get justified(): CheckpointWithTotalBalance {
    return this._justified;
  }
  set justified(justified: CheckpointWithBalance) {
    this._justified = {...justified, totalBalance: computeTotalBalance(justified.balances)};
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

  /**
   * Notify subscribers that the Fast Confirmation Rule executed and produced
   * `data.block` at `data.slot`. Per beacon-APIs PR #598, this fires once per
   * FCR execution (i.e., once per slot when FCR is enabled), regardless of
   * whether `confirmedRoot` actually changed.
   */
  notifyFastConfirmation(data: {block: RootHex; slot: Slot; currentSlot: Slot}): void {
    this.events?.onFastConfirmation?.(data);
  }
}

export function toCheckpointWithHex(checkpoint: phase0.Checkpoint): CheckpointWithHex {
  // `valueOf` coerses the checkpoint, which may be tree-backed, into a javascript object
  // See https://github.com/ChainSafe/lodestar/issues/2258
  const root = checkpoint.root;
  return {
    epoch: checkpoint.epoch,
    root,
    rootHex: toRootHex(root),
  };
}

export function equalCheckpointWithHex(a: CheckpointWithHex, b: CheckpointWithHex): boolean {
  return a.epoch === b.epoch && a.rootHex === b.rootHex;
}

export function computeTotalBalance(balances: EffectiveBalanceIncrements): number {
  let totalBalance = 0;
  for (let i = 0; i < balances.length; i++) {
    totalBalance += balances[i];
  }
  return totalBalance;
}
