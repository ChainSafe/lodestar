import {CompactMultiProof} from "@chainsafe/persistent-merkle-tree";
import {BitArray, ByteViews} from "@chainsafe/ssz";
import {
  ForkName,
  ForkPostAltair,
  ForkPostBellatrix,
  ForkPostCapella,
  ForkPostDeneb,
  ForkPostElectra,
  ForkPostFulu,
  ForkPostGloas,
  isForkPostAltair,
  isForkPostBellatrix,
  isForkPostCapella,
  isForkPostDeneb,
  isForkPostElectra,
  isForkPostFulu,
  isForkPostGloas,
} from "@lodestar/params";
import {
  BeaconBlock,
  BeaconState,
  BlindedBeaconBlock,
  BuilderIndex,
  Bytes32,
  CommitteeIndex,
  Epoch,
  ExecutionPayloadBid,
  ExecutionPayloadHeader,
  Root,
  RootHex,
  SignedBeaconBlock,
  SignedBlindedBeaconBlock,
  Slot,
  ValidatorIndex,
  altair,
  capella,
  electra,
  fulu,
  gloas,
  phase0,
  rewards,
} from "@lodestar/types";
import {Checkpoint, Fork} from "@lodestar/types/phase0";
import {VoluntaryExitValidity} from "../block/processVoluntaryExit.js";
import {EffectiveBalanceIncrements} from "../cache/effectiveBalanceIncrements.js";
import {EpochTransitionCacheOpts} from "../cache/epochTransitionCache.js";
import {RewardCache} from "../cache/rewardCache.js";
import {SyncCommitteeCache} from "../cache/syncCommitteeCache.js";
import {SyncCommitteeWitness} from "../lightClient/types.js";
import {StateTransitionModules, StateTransitionOpts} from "../stateTransition.js";
import {EpochShuffling} from "../util/epochShuffling.js";

/**
 * A read-only view of the BeaconState.
 */
export interface IBeaconStateView {
  // State access

  // phase0
  forkName: ForkName;
  slot: Slot;
  fork: Fork;
  epoch: Epoch;
  genesisTime: number;
  genesisValidatorsRoot: Root;
  eth1Data: phase0.Eth1Data;
  latestBlockHeader: phase0.BeaconBlockHeader;
  previousJustifiedCheckpoint: Checkpoint;
  currentJustifiedCheckpoint: Checkpoint;
  finalizedCheckpoint: Checkpoint;
  getBlockRootAtSlot(slot: Slot): Root;
  getBlockRootAtEpoch(epoch: Epoch): Root;
  getStateRootAtSlot(slot: Slot): Root;
  getRandaoMix(epoch: Epoch): Bytes32;

  // Shuffling and committees
  getShufflingAtEpoch(epoch: Epoch): EpochShuffling;
  getBeaconCommittee(slot: Slot, index: CommitteeIndex): Uint32Array;
  getBeaconCommitteeCountPerSlot(epoch: Epoch): number;
  // Decision roots
  previousDecisionRoot: RootHex;
  currentDecisionRoot: RootHex;
  nextDecisionRoot: RootHex;
  getShufflingDecisionRoot(epoch: Epoch): RootHex;
  getPreviousShuffling(): EpochShuffling;
  getCurrentShuffling(): EpochShuffling;
  getNextShuffling(): EpochShuffling;

  // Proposer shuffling
  previousProposers: ValidatorIndex[] | null;
  currentProposers: ValidatorIndex[];
  nextProposers: ValidatorIndex[];
  getBeaconProposer(slot: Slot): ValidatorIndex;

  // Validators and balances
  effectiveBalanceIncrements: EffectiveBalanceIncrements;
  getEffectiveBalanceIncrementsZeroInactive(): EffectiveBalanceIncrements;
  getBalance(index: number): number;
  // readonly
  getValidator(index: ValidatorIndex): phase0.Validator;
  getValidatorsByStatus(statuses: Set<string>, currentEpoch: Epoch): phase0.Validator[];
  validatorCount: number;
  // this get number of active validators in the current shuffling
  activeValidatorCount: number;
  // this is needed for apis only
  getAllValidators(): phase0.Validator[];
  getAllBalances(): number[];

  // API
  proposerRewards: RewardCache;
  computeBlockRewards(block: BeaconBlock, proposerRewards?: RewardCache): Promise<rewards.BlockRewards>;
  computeAttestationsRewards(validatorIds?: (ValidatorIndex | string)[]): Promise<rewards.AttestationsRewards>;
  getLatestWeakSubjectivityCheckpointEpoch(): Epoch;

  // Validation
  getVoluntaryExitValidity(
    signedVoluntaryExit: phase0.SignedVoluntaryExit,
    verifySignature: boolean
  ): VoluntaryExitValidity;
  isValidVoluntaryExit(signedVoluntaryExit: phase0.SignedVoluntaryExit, verifySignature: boolean): boolean;

  // Proofs
  getFinalizedRootProof(): Uint8Array[];
  getSingleProof(gindex: bigint): Uint8Array[];
  createMultiProof(descriptor: Uint8Array): CompactMultiProof;

  // Fork choice
  computeUnrealizedCheckpoints(): {
    justifiedCheckpoint: phase0.Checkpoint;
    finalizedCheckpoint: phase0.Checkpoint;
  };
  computeAnchorCheckpoint(): {checkpoint: phase0.Checkpoint; blockHeader: phase0.BeaconBlockHeader};

  // this is for backward compatible
  clonedCount: number;
  clonedCountWithTransferCache: number;
  createdWithTransferCache: boolean;
  // TODO is there a better name that is less implementation specific but still conveys the meaning?
  isStateValidatorsNodesPopulated(): boolean;

  // Serialization
  /** Set `preloadValidatorsAndBalances` only when the whole state will be consumed
   *  immediately (e.g. CP reload before block replay). */
  loadOtherState(
    stateBytes: Uint8Array,
    seedValidatorsBytes?: Uint8Array,
    opts?: {preloadValidatorsAndBalances?: boolean}
  ): IBeaconStateView;
  toValue(): BeaconState;
  serialize(): Uint8Array;
  serializedSize(): number;
  serializeToBytes(output: ByteViews, offset: number): number;
  serializeValidators(): Uint8Array;
  serializedValidatorsSize(): number;
  serializeValidatorsToBytes(output: ByteViews, offset: number): number;

  hashTreeRoot(): Uint8Array;

  // State transition
  stateTransition(
    signedBlock: SignedBeaconBlock | SignedBlindedBeaconBlock,
    options: StateTransitionOpts,
    modules: StateTransitionModules
  ): IBeaconStateView;
  processSlots(
    slot: Slot,
    epochTransitionCacheOpts?: EpochTransitionCacheOpts & {dontTransferCache?: boolean},
    modules?: StateTransitionModules
  ): IBeaconStateView;
}

/** Altair+ state fields — use isStatePostAltair() guard */
export interface IBeaconStateViewAltair extends IBeaconStateView {
  forkName: ForkPostAltair;
  previousEpochParticipation: Uint8Array;
  currentEpochParticipation: Uint8Array;
  getPreviousEpochParticipation(validatorIndex: ValidatorIndex): number;
  getCurrentEpochParticipation(validatorIndex: ValidatorIndex): number;
  currentSyncCommittee: altair.SyncCommittee;
  nextSyncCommittee: altair.SyncCommittee;
  currentSyncCommitteeIndexed: SyncCommitteeCache;
  syncProposerReward: number;
  getIndexedSyncCommitteeAtEpoch(epoch: Epoch): SyncCommitteeCache;
  /** Get indexed sync committee with slot+1 offset for duty lookups */
  getIndexedSyncCommittee(slot: Slot): SyncCommitteeCache;
  computeSyncCommitteeRewards(
    block: BeaconBlock,
    validatorIds: (ValidatorIndex | string)[]
  ): Promise<rewards.SyncCommitteeRewards>;
  getSyncCommitteesWitness(): SyncCommitteeWitness;
}

/** Bellatrix+ state fields — use isStatePostBellatrix() guard */
export interface IBeaconStateViewBellatrix extends IBeaconStateViewAltair {
  forkName: ForkPostBellatrix;
  latestExecutionPayloadHeader: ExecutionPayloadHeader;
  /**
   * The execution block number of the most recently included payload.
   * Named payloadBlockNumber (not latestBlockNumber) to mirror ExecutionPayloadHeader.blockNumber pre-gloas.
   * Only available from bellatrix through fulu — not tracked on BeaconState in gloas+ (EIP-7732).
   * Throws before bellatrix and from gloas onwards.
   */
  payloadBlockNumber: number;
  isExecutionStateType: boolean;
  isMergeTransitionComplete: boolean;
  isExecutionEnabled(block: BeaconBlock | BlindedBeaconBlock): boolean;
}

/** Capella+ state fields — use isStatePostCapella() guard */
export interface IBeaconStateViewCapella extends IBeaconStateViewBellatrix {
  forkName: ForkPostCapella;
  historicalSummaries: capella.HistoricalSummaries;
  getExpectedWithdrawals(): {
    expectedWithdrawals: capella.Withdrawal[];
    processedBuilderWithdrawalsCount: number;
    processedPartialWithdrawalsCount: number;
    processedBuildersSweepCount: number;
    processedValidatorSweepCount: number;
  };
}

/** Deneb+ state — no new state-view fields; placeholder for fork completeness and isStatePostDeneb() narrowing */
export interface IBeaconStateViewDeneb extends IBeaconStateViewCapella {
  forkName: ForkPostDeneb;
}

/** Electra+ state fields — use isStatePostElectra() guard */
export interface IBeaconStateViewElectra extends IBeaconStateViewDeneb {
  forkName: ForkPostElectra;
  pendingDeposits: electra.PendingDeposits;
  pendingDepositsCount: number;
  pendingPartialWithdrawals: electra.PendingPartialWithdrawals;
  pendingPartialWithdrawalsCount: number;
  pendingConsolidations: electra.PendingConsolidations;
  pendingConsolidationsCount: number;
}

/** Fulu+ state fields — use isStatePostFulu() guard */
export interface IBeaconStateViewFulu extends IBeaconStateViewElectra {
  forkName: ForkPostFulu;
  proposerLookahead: fulu.ProposerLookahead;
}

/** Gloas+ state fields — use isStatePostGloas() guard */
export interface IBeaconStateViewGloas extends IBeaconStateViewFulu {
  forkName: ForkPostGloas;
  /** Removed from BeaconState in gloas. Use `latestBlockHash` instead. */
  latestExecutionPayloadHeader: never;
  /** Removed from BeaconState in gloas. */
  payloadBlockNumber: never;
  latestBlockHash: Bytes32;
  executionPayloadAvailability: BitArray;
  latestExecutionPayloadBid: ExecutionPayloadBid;
  payloadExpectedWithdrawals: capella.Withdrawal[];
  getBuilder(index: BuilderIndex): gloas.Builder;
  canBuilderCoverBid(builderIndex: BuilderIndex, bidAmount: number): boolean;
  getEpochPTCs(epoch: Epoch): Uint32Array[];
  getIndexInPayloadTimelinessCommittee(validatorIndex: ValidatorIndex, slot: Slot): number;
  /**
   * Clone the state and apply parent execution payload effects.
   * Used during block production and prepareNextSlot so that withdrawals and
   * operation selection (e.g. voluntary exits) see the same post-apply state that the block
   * processor will see at import.
   */
  withParentPayloadApplied(executionRequests: electra.ExecutionRequests): IBeaconStateViewGloas;
}

/**
 * Type constraint for the concrete BeaconStateView class.
 * Requires all fields from the latest fork interface (IBeaconStateViewGloas) but keeps
 * forkName as ForkName since the class wraps any fork's state.
 * Sub-interfaces retain their narrowed forkName discriminants for caller-side type guards.
 */
export type IBeaconStateViewLatestFork = Omit<
  IBeaconStateViewGloas,
  "forkName" | "latestExecutionPayloadHeader" | "payloadBlockNumber"
> & {
  forkName: ForkName;
  latestExecutionPayloadHeader: ExecutionPayloadHeader;
  payloadBlockNumber: number;
};
export function isStatePostAltair(state: IBeaconStateView): state is IBeaconStateViewAltair {
  return isForkPostAltair(state.forkName);
}

export function isStatePostBellatrix(state: IBeaconStateView): state is IBeaconStateViewBellatrix {
  return isForkPostBellatrix(state.forkName);
}

export function isStatePostCapella(state: IBeaconStateView): state is IBeaconStateViewCapella {
  return isForkPostCapella(state.forkName);
}

export function isStatePostDeneb(state: IBeaconStateView): state is IBeaconStateViewDeneb {
  return isForkPostDeneb(state.forkName);
}

export function isStatePostElectra(state: IBeaconStateView): state is IBeaconStateViewElectra {
  return isForkPostElectra(state.forkName);
}

export function isStatePostFulu(state: IBeaconStateView): state is IBeaconStateViewFulu {
  return isForkPostFulu(state.forkName);
}

export function isStatePostGloas(state: IBeaconStateView): state is IBeaconStateViewGloas {
  return isForkPostGloas(state.forkName);
}
