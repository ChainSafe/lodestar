import {EffectiveBalanceIncrements, IBeaconStateView} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {PayloadStatus, ProtoBlock} from "../../protoArray/interface.js";
import {CheckpointWithHex} from "../store.js";

export type FastConfirmationBalanceSource = {
  state: IBeaconStateView | null;
  balances: EffectiveBalanceIncrements;
};

export type BalanceSourceCacheKey = IBeaconStateView | EffectiveBalanceIncrements;

/** Effective balances of the validators active at the balance source epoch, slashed included, and their sum */
export type ActiveBalances = {balances: EffectiveBalanceIncrements; total: number};

export type ForkChoiceStateGetter = (
  opts: {stateRoot: RootHex; checkpoint?: never} | {stateRoot?: never; checkpoint: CheckpointWithHex}
) => IBeaconStateView | null;

export type IFastConfirmationSpecStore = {
  confirmedRoot: RootHex;
  previousEpochObservedJustifiedCheckpoint: CheckpointWithHex;
  currentEpochObservedJustifiedCheckpoint: CheckpointWithHex;
  previousEpochGreatestUnrealizedCheckpoint: CheckpointWithHex;
  previousSlotHead: RootHex;
  currentSlotHead: RootHex;
};

type IFastConfirmationAuxStore = {
  previousEpochObservedJustifiedBalances: EffectiveBalanceIncrements;
  currentEpochObservedJustifiedBalances: EffectiveBalanceIncrements;
  previousEpochGreatestUnrealizedBalances: EffectiveBalanceIncrements;
  stateGetter: ForkChoiceStateGetter;
};

export type IFastConfirmationStore = IFastConfirmationSpecStore & IFastConfirmationAuxStore;

export type FastConfirmationResult = {
  confirmedRoot: RootHex;
  didReset?: boolean;
};

export type FastConfirmationSnapshot = {
  currentSlot: Slot;
  currentEpoch: Epoch;
  headRoot: RootHex;
  confirmedRoot: RootHex;
  confirmedEpoch: Epoch | null;
  confirmedSlot: Slot | null;
  observedJustified: CheckpointWithHex;
  headUnrealized: CheckpointWithHex | null;
  finalizedRoot: RootHex;
};

export enum FastConfirmationDecisionReason {
  Unchanged = "unchanged",
  ConfirmedNotFound = "confirmed_not_found",
  ResetBehind = "reset_behind",
  ResetNotAncestor = "reset_not_ancestor",
  ResetChainUnsafe = "reset_chain_unsafe",
  ObservedJustified = "observed_justified",
  ConfirmedDescendant = "confirmed_descendant",
}

/** Reasons where the confirmed root is pulled backward (a reset), as opposed to advanced forward. */
const RESET_REASONS = new Set<FastConfirmationDecisionReason>([
  FastConfirmationDecisionReason.ConfirmedNotFound,
  FastConfirmationDecisionReason.ResetBehind,
  FastConfirmationDecisionReason.ResetNotAncestor,
  FastConfirmationDecisionReason.ResetChainUnsafe,
]);

export function isResetReason(reason: FastConfirmationDecisionReason): boolean {
  return RESET_REASONS.has(reason);
}

export type FastConfirmationDecision = {
  confirmedRoot: RootHex;
  didReset: boolean;
  reason: FastConfirmationDecisionReason;
};

export type FastConfirmationRunResult = FastConfirmationDecision & {
  /**
   * Cause of the reset, when one occurred.
   * The `reason` attribute reports the final disposition and can be different.
   */
  resetReason?: FastConfirmationDecisionReason;
  /** Confirmed block became non-canonical (no longer an ancestor of head) */
  didReorg: boolean;
  /** Confirmed block reverted to the finalized checkpoint */
  didFallback: boolean;
  /** Restarted confirmation from the observed unrealized justified checkpoint */
  didRestart: boolean;
};

export type FastConfirmationRule = (
  snapshot: FastConfirmationSnapshot,
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache,
  decision: FastConfirmationDecision,
  logger?: Logger
) => FastConfirmationDecision;

export type BalanceSourceKey = "current" | "previous";

/**
 * Committees of the slots ending at a fixed slot, swept backwards one slot at a time over the head
 * state shuffling. A validator is recorded at the latest slot it is assigned to, so the committees of
 * any range ending at that slot are a prefix of `order` with no duplicates, even when the range
 * crosses an epoch boundary and the two epochs' committees overlap.
 */
export type CommitteeSweep = {
  /** Marks validators already placed in `order`, indexed by validator index */
  seen: Uint8Array;
  /** Validators of the end slot, then those first seen one slot earlier, and so on */
  order: Uint32Array;
  /** Length of the `order` prefix covering the last `i + 1` slots, for each swept slot `i` */
  lengths: number[];
  /** Committee weight of the last `i + 1` slots, per balance source, filled on demand */
  weightsByKey: Map<BalanceSourceCacheKey, number[]>;
};

// This cache is created once per slot
export type FastConfirmationCache = {
  blockByRoot: Map<RootHex, ProtoBlock | null>;
  ancestorRoots: Map<string, RootHex[] | null>;
  committeeSweepByEndSlot: Map<Slot, CommitteeSweep>;
  isDescendantByRootPair: Map<string, boolean>;
  /** voteRoot -> totalWeight, keyed by sourceKey */
  voteWeightBySource: Map<BalanceSourceKey, Map<RootHex, number>>;
  /** active balances and their total, keyed by the balance source's state or balances reference */
  activeBalancesByKey: Map<BalanceSourceCacheKey, ActiveBalances>;
  headState?: IBeaconStateView;
  pulledUpHeadState?: IBeaconStateView;
  checkpointStateByKey: Map<string, IBeaconStateView | null>;
};

export type FastConfirmationContext = {
  config: {
    CONFIRMATION_BYZANTINE_THRESHOLD: number;
    PROPOSER_SCORE_BOOST: number;
  };
  getCurrentSlot(): Slot;
  getHead(): ProtoBlock;
  getBlock(root: RootHex): ProtoBlock | null;
  getAncestor(root: RootHex, slot: Slot): RootHex;
  isDescendant(ancestor: RootHex, descendant: RootHex): boolean;
  getLatestMessage(validatorIndex: ValidatorIndex): {root: RootHex; payloadStatus: PayloadStatus; epoch: Epoch} | null;
  getParentNodePayloadStatus(blockRoot: RootHex): PayloadStatus | null;
  getUnrealizedJustified(): {checkpoint: CheckpointWithHex; balances: EffectiveBalanceIncrements};
  getFinalizedCheckpoint(): CheckpointWithHex;
  getEquivocatingIndices(): Set<ValidatorIndex>;
  getTrackedVotesCount(): number;
};

export interface IFastConfirmationRule {
  getConfirmedRoot(): RootHex;
  onSlotStartAfterPastAttestationsApplied(ctx: FastConfirmationContext): FastConfirmationResult;
}
