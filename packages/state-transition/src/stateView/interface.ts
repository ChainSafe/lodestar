import {CompactMultiProof} from "@chainsafe/persistent-merkle-tree";
import {BitArray, ByteViews} from "@chainsafe/ssz";
import {
  ForkName,
  ForkPostElectra,
  ForkPostFulu,
  ForkPostGloas,
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
import {ProcessExecutionPayloadEnvelopeOpts} from "../block/processExecutionPayloadEnvelope.js";
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

  // altair
  previousEpochParticipation: Uint8Array;
  currentEpochParticipation: Uint8Array;
  getPreviousEpochParticipation(validatorIndex: ValidatorIndex): number;
  getCurrentEpochParticipation(validatorIndex: ValidatorIndex): number;

  // bellatrix
  latestExecutionPayloadHeader: ExecutionPayloadHeader;
  /**
   * Cross-fork accessor for the execution block hash of the most recently included payload.
   * Pre-gloas: returns latestExecutionPayloadHeader.blockHash (bellatrix–fulu).
   * Gloas+: returns the dedicated latestBlockHash state field (EIP-7732).
   * Throws before bellatrix.
   */
  latestBlockHash: Bytes32;
  /**
   * The execution block number of the most recently included payload.
   * Named payloadBlockNumber (not latestBlockNumber) to mirror ExecutionPayloadHeader.blockNumber pre-gloas.
   * Only available from bellatrix through fulu — not tracked on BeaconState in gloas+ (EIP-7732).
   * Throws before bellatrix and from gloas onwards.
   */
  payloadBlockNumber: number;

  // capella
  historicalSummaries: capella.HistoricalSummaries;

  // Shuffling and committees
  getShufflingAtEpoch(epoch: Epoch): EpochShuffling;
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

  // Sync committees
  currentSyncCommittee: altair.SyncCommittee;
  nextSyncCommittee: altair.SyncCommittee;
  currentSyncCommitteeIndexed: SyncCommitteeCache;
  syncProposerReward: number;
  getIndexedSyncCommitteeAtEpoch(epoch: Epoch): SyncCommitteeCache;
  /** Get indexed sync committee with slot+1 offset for duty lookups */
  getIndexedSyncCommittee(slot: Slot): SyncCommitteeCache;

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

  // Merge
  isExecutionStateType: boolean;
  isMergeTransitionComplete: boolean;
  // TODO this should go away (or rather only need block)
  isExecutionEnabled(block: BeaconBlock | BlindedBeaconBlock): boolean;

  // Block production
  getExpectedWithdrawals(): {
    expectedWithdrawals: capella.Withdrawal[];
    processedBuilderWithdrawalsCount: number;
    processedPartialWithdrawalsCount: number;
    processedBuildersSweepCount: number;
    processedValidatorSweepCount: number;
  };

  // API
  proposerRewards: RewardCache;
  computeBlockRewards(block: BeaconBlock, proposerRewards?: RewardCache): Promise<rewards.BlockRewards>;
  computeAttestationsRewards(validatorIds?: (ValidatorIndex | string)[]): Promise<rewards.AttestationsRewards>;
  computeSyncCommitteeRewards(
    block: BeaconBlock,
    validatorIds: (ValidatorIndex | string)[]
  ): Promise<rewards.SyncCommitteeRewards>;
  getLatestWeakSubjectivityCheckpointEpoch(): Epoch;

  // Validation
  getVoluntaryExitValidity(
    signedVoluntaryExit: phase0.SignedVoluntaryExit,
    verifySignature: boolean
  ): VoluntaryExitValidity;
  isValidVoluntaryExit(signedVoluntaryExit: phase0.SignedVoluntaryExit, verifySignature: boolean): boolean;

  // Proofs
  getFinalizedRootProof(): Uint8Array[];
  getSyncCommitteesWitness(): SyncCommitteeWitness;
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
  loadOtherState(stateBytes: Uint8Array, seedValidatorsBytes?: Uint8Array): IBeaconStateView;
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

/** Electra+ state fields — use isStatePostElectra() guard */
export interface IBeaconStateViewElectra extends IBeaconStateView {
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
  executionPayloadAvailability: BitArray;
  latestExecutionPayloadBid: ExecutionPayloadBid;
  getBuilder(index: BuilderIndex): gloas.Builder;
  canBuilderCoverBid(builderIndex: BuilderIndex, bidAmount: number): boolean;
  getIndexInPayloadTimelinessCommittee(validatorIndex: ValidatorIndex, slot: Slot): number;
  processExecutionPayloadEnvelope(
    signedEnvelope: gloas.SignedExecutionPayloadEnvelope,
    opts?: ProcessExecutionPayloadEnvelopeOpts
  ): IBeaconStateView;
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
