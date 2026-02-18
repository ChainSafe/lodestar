import {CachedBeaconStateAllForks, EffectiveBalanceIncrements} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import {ProtoBlock} from "../../protoArray/interface.ts";
import {CheckpointWithHex} from "../store.ts";

export type FCRBalanceSource = {
  state: CachedBeaconStateAllForks | null;
  balances: EffectiveBalanceIncrements;
};

export type ForkChoiceStateGetter = (
  opts: {stateRoot: RootHex; checkpoint?: never} | {stateRoot?: never; checkpoint: CheckpointWithHex}
) => CachedBeaconStateAllForks | null;

export type IFCRStore = {
  confirmedRoot: RootHex;
  previousEpochObservedJustifiedCheckpoint: CheckpointWithHex;
  currentEpochObservedJustifiedCheckpoint: CheckpointWithHex;
  previousEpochObservedJustifiedBalances: EffectiveBalanceIncrements;
  currentEpochObservedJustifiedBalances: EffectiveBalanceIncrements;
  previousSlotHead: RootHex;
  currentSlotHead: RootHex;
  stateGetter: ForkChoiceStateGetter;
};

export type FCRResult = {
  confirmedRoot: RootHex;
  didReset?: boolean;
};

export type FCRSnapshot = {
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

export type FCRDecision = {
  confirmedRoot: RootHex;
  didReset: boolean;
  stop?: boolean;
  reason?: string;
};

export type FCRRule = (
  snapshot: FCRSnapshot,
  ctx: FCRContext,
  store: IFCRStore,
  cache: FCRCache,
  decision: FCRDecision
) => FCRDecision;

export type FCRCache = {
  blockByRoot: Map<RootHex, ProtoBlock | null>;
  epochByRoot: Map<RootHex, Epoch | null>;
  slotByRoot: Map<RootHex, Slot | null>;
  ancestorRoots: Map<string, RootHex[]>;
  committeeBySlot: Map<Slot, Set<ValidatorIndex>>;
  headState?: CachedBeaconStateAllForks | null;
  checkpointStateByKey: Map<string, CachedBeaconStateAllForks | null>;
};

export type FCRContext = {
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
  onSlotStartAfterPastAttestationsApplied(ctx: FCRContext): FCRResult;
}
