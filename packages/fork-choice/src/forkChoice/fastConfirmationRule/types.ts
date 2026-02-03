import {CachedBeaconStateAllForks, EffectiveBalanceIncrements} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import {ProtoBlock} from "../../protoArray/interface.ts";
import {CheckpointWithHex} from "../store.js";

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
