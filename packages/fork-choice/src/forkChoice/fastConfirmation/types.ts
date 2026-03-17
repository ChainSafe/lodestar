import {CachedBeaconStateAllForks, EffectiveBalanceIncrements} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {ProtoBlock} from "../../protoArray/interface.ts";
import {CheckpointWithHex} from "../store.ts";

export type FastConfirmationBalanceSource = {
  state: CachedBeaconStateAllForks | null;
  balances: EffectiveBalanceIncrements;
};

export type ForkChoiceStateGetter = (
  opts: {stateRoot: RootHex; checkpoint?: never} | {stateRoot?: never; checkpoint: CheckpointWithHex}
) => CachedBeaconStateAllForks | null;

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

export type FastConfirmationDecision = {
  confirmedRoot: RootHex;
  didReset: boolean;
  stop?: boolean;
  reason?: string;
};

export type FastConfirmationRule = (
  snapshot: FastConfirmationSnapshot,
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache,
  decision: FastConfirmationDecision,
  logger?: Logger
) => FastConfirmationDecision;

export type FastConfirmationCache = {
  blockByRoot: Map<RootHex, ProtoBlock | null>;
  ancestorRoots: Map<string, RootHex[] | null>;
  committeeBySlot: Map<Slot, Set<ValidatorIndex>>;
  isDescendantByRootPair: Map<string, boolean>;
  /** voteRoot -> totalWeight, keyed by sourceKey ("current" | "previous") */
  voteWeightBySource: Map<string, Map<RootHex, number>>;
  headState?: CachedBeaconStateAllForks | null;
  checkpointStateByKey: Map<string, CachedBeaconStateAllForks | null>;
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
