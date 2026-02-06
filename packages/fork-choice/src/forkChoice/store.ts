import {CachedBeaconStateAllForks, EffectiveBalanceIncrements} from "@lodestar/state-transition";
import {RootHex, Slot, ValidatorIndex, phase0} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {PayloadStatus} from "../protoArray/interface.js";
import {CheckpointWithPayloadAndBalance, CheckpointWithPayloadAndTotalBalance} from "./interface.js";

/**
 * Stores checkpoints in a hybrid format:
 * - Original checkpoint for fast consumption in Lodestar's side
 * - Root in string hex for fast comparisons inside the fork-choice
 */
export type CheckpointWithHex = phase0.Checkpoint & {rootHex: RootHex};

/**
 * Checkpoint with payload status for Gloas fork choice.
 * Used to track which variant (EMPTY or FULL) of the finalized/justified block to use.
 *
 * Pre-Gloas: payloadStatus is always FULL (payload embedded in block)
 * Gloas: determined by state.execution_payload_availability
 */
export type CheckpointWithPayload = CheckpointWithHex & {payloadStatus: PayloadStatus};

export type JustifiedBalances = EffectiveBalanceIncrements;

/**
 * Returns the justified balances of checkpoint.
 * MUST not throw an error in any case, related to cache miss. Either trigger regen or approximate from a close state.
 * `blockState` is maybe used as a fallback state to get balances since it's very close to desired justified state.
 * @param blockState state that declares justified checkpoint `checkpoint`
 */
export type JustifiedBalancesGetter = (
  checkpoint: CheckpointWithPayload,
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
  get justified(): CheckpointWithPayloadAndTotalBalance;
  set justified(justified: CheckpointWithPayloadAndBalance);
  unrealizedJustified: CheckpointWithPayloadAndBalance;
  finalizedCheckpoint: CheckpointWithPayload;
  unrealizedFinalizedCheckpoint: CheckpointWithPayload;
  justifiedBalancesGetter: JustifiedBalancesGetter;
  equivocatingIndices: Set<ValidatorIndex>;
}

/**
 * IForkChoiceStore implementer which emits forkChoice events on updated justified and finalized checkpoints.
 */
export class ForkChoiceStore implements IForkChoiceStore {
  private _justified: CheckpointWithPayloadAndTotalBalance;
  unrealizedJustified: CheckpointWithPayloadAndBalance;
  private _finalizedCheckpoint: CheckpointWithPayload;
  unrealizedFinalizedCheckpoint: CheckpointWithPayload;
  equivocatingIndices = new Set<ValidatorIndex>();
  justifiedBalancesGetter: JustifiedBalancesGetter;
  currentSlot: Slot;

  constructor(
    currentSlot: Slot,
    justifiedCheckpoint: phase0.Checkpoint,
    finalizedCheckpoint: phase0.Checkpoint,
    justifiedBalances: EffectiveBalanceIncrements,
    justifiedBalancesGetter: JustifiedBalancesGetter,
    /**
     * Payload status for justified checkpoint.
     * Pre-Gloas: always FULL
     * Gloas: determined by state.execution_payload_availability
     */
    justifiedPayloadStatus: PayloadStatus,
    /**
     * Payload status for finalized checkpoint.
     * Pre-Gloas: always FULL
     * Gloas: determined by state.execution_payload_availability
     */
    finalizedPayloadStatus: PayloadStatus,
    private readonly events?: {
      onJustified: (cp: CheckpointWithPayload) => void;
      onFinalized: (cp: CheckpointWithPayload) => void;
    }
  ) {
    this.justifiedBalancesGetter = justifiedBalancesGetter;
    this.currentSlot = currentSlot;
    const justified = {
      checkpoint: toCheckpointWithPayload(justifiedCheckpoint, justifiedPayloadStatus),
      balances: justifiedBalances,
      totalBalance: computeTotalBalance(justifiedBalances),
    };
    this._justified = justified;
    this.unrealizedJustified = justified;
    this._finalizedCheckpoint = toCheckpointWithPayload(finalizedCheckpoint, finalizedPayloadStatus);
    this.unrealizedFinalizedCheckpoint = this._finalizedCheckpoint;
  }

  get justified(): CheckpointWithPayloadAndTotalBalance {
    return this._justified;
  }
  set justified(justified: CheckpointWithPayloadAndBalance) {
    this._justified = {...justified, totalBalance: computeTotalBalance(justified.balances)};
    this.events?.onJustified(justified.checkpoint);
  }

  get finalizedCheckpoint(): CheckpointWithPayload {
    return this._finalizedCheckpoint;
  }
  set finalizedCheckpoint(checkpoint: CheckpointWithPayload) {
    const cp = toCheckpointWithPayload(checkpoint, checkpoint.payloadStatus);
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
    rootHex: toRootHex(root),
  };
}

export function toCheckpointWithPayload(
  checkpoint: phase0.Checkpoint,
  payloadStatus: PayloadStatus
): CheckpointWithPayload {
  return {
    ...toCheckpointWithHex(checkpoint),
    payloadStatus,
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
