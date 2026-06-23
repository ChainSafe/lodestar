import {EffectiveBalanceIncrements, IBeaconStateView} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {ProtoBlock} from "../../protoArray/interface.ts";
import {CheckpointWithHex} from "../store.ts";

export type FastConfirmationBalanceSource = {
  state: IBeaconStateView | null;
  balances: EffectiveBalanceIncrements;
};

export type ForkChoiceStateGetter = (
  opts: {stateRoot: RootHex; checkpoint?: never} | {stateRoot?: never; checkpoint: CheckpointWithHex}
) => IBeaconStateView | null;

type IFastConfirmationSpecStore = {
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

export type FastConfirmationDecision = {
  confirmedRoot: RootHex;
  didReset: boolean;
  reason: FastConfirmationDecisionReason;
};

export type FastConfirmationRunResult = FastConfirmationDecision & {
  /** Confirmed block became non-canonical (no longer an ancestor of head) */
  didReorg: boolean;
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

// This cache is created once per slot
export type FastConfirmationCache = {
  blockByRoot: Map<RootHex, ProtoBlock | null>;
  ancestorRoots: Map<string, RootHex[] | null>;
  committeeBySlot: Map<Slot, Set<ValidatorIndex>>;
  isDescendantByRootPair: Map<string, boolean>;
  /** voteRoot -> totalWeight, keyed by sourceKey */
  voteWeightBySource: Map<BalanceSourceKey, Map<RootHex, number>>;
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
  getLatestMessage(validatorIndex: ValidatorIndex): {root: RootHex; epoch: Epoch} | null;
  getUnrealizedJustified(): {checkpoint: CheckpointWithHex; balances: EffectiveBalanceIncrements};
  getFinalizedCheckpoint(): CheckpointWithHex;
  getEquivocatingIndices(): Set<ValidatorIndex>;
  getTrackedVotesCount(): number;
};

export interface IFastConfirmationRule {
  getConfirmedRoot(): RootHex;
  onSlotStartAfterPastAttestationsApplied(ctx: FastConfirmationContext): FastConfirmationResult;
}
