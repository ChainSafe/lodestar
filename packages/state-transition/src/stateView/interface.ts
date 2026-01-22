import {CompactMultiProof} from "@chainsafe/persistent-merkle-tree";
import {ByteViews} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {ForkName, ForkSeq} from "@lodestar/params";
import {
  BeaconBlock,
  BlindedBeaconBlock,
  Bytes32,
  Epoch,
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

/**
 * A read-only view of the BeaconState.
 */
export interface IBeaconStateView {
  slot: Slot;
  fork: Fork;
  epoch: Epoch;
  genesisTime: number;
  genesisValidatorsRoot: Root;
  eth1Data: phase0.Eth1Data;
  latestBlockHeader: phase0.BeaconBlockHeader;
  previousDecisionRoot: RootHex;
  currentDecisionRoot: RootHex;
  nextDecisionRoot: RootHex;
  previousJustifiedCheckpoint: Checkpoint;
  currentJustifiedCheckpoint: Checkpoint;
  finalizedCheckpoint: Checkpoint;
  proposers: ValidatorIndex[];
  proposersNextEpoch: ValidatorIndex[];
  currentSyncCommittee: altair.SyncCommittee;
  nextSyncCommittee: altair.SyncCommittee;
  currentSyncCommitteeIndexed: SyncCommitteeCache;
  // Proposers for previous epoch, initialized to null in first epoch
  proposersPrevEpoch: ValidatorIndex[] | null;
  effectiveBalanceIncrements: EffectiveBalanceIncrements;
  latestExecutionPayloadHeader: ExecutionPayloadHeader;
  syncProposerReward: number;
  previousEpochParticipation: number[];
  currentEpochParticipation: number[];
  executionPayloadAvailability: boolean[];
  proposerRewards: RewardCache;
  // electra - specific
  pendingDepositsLength: number;
  pendingPartialWithdrawalsLength: number;
  pendingConsolidationsLength: number;

  // this is for backward compatible
  clonedCount: number;
  clonedCountWithTransferCache: number;
  createdWithTransferCache: boolean;

  isStateValidatorsNodesPopulated(): boolean;
  serialize(): Uint8Array;
  serializedSize(): number;
  serializeToBytes(output: ByteViews, offset: number): number;
  serializeValidators(): Uint8Array;
  serializedValidatorsSize(): number;
  serializeValidatorsToBytes(output: ByteViews, offset: number): number;
  hashTreeRoot(): Uint8Array;
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
  loadOtherState(config: ChainForkConfig, stateBytes: Uint8Array, seedValidatorsBytes?: Uint8Array): IBeaconStateView;

  // this maps to getReadonly of CachedBeaconStateAllForks
  // we should not modify validator through this api, only state-transition should do that
  getValidator(index: ValidatorIndex): phase0.Validator;
  getValidatorsByStatus(statuses: Set<string>, currentEpoch: Epoch): phase0.Validator[];
  getValidatorCount(): number;
  // this get number of active validators in the current shuffling
  getActiveValidatorCount(): number;
  getBeaconProposer(slot: Slot): ValidatorIndex;
  getBeaconProposers(): ValidatorIndex[];
  getBeaconProposersPrevEpoch(): ValidatorIndex[] | null;
  getBeaconProposersNextEpoch(): ValidatorIndex[];
  getShufflingDecisionRoot(epoch: Epoch): RootHex;
  getIndexedSyncCommitteeAtEpoch(epoch: Epoch): SyncCommitteeCache;
  getBlockRootAtSlot(slot: Slot): Root;
  getBlockRoot(epoch: Epoch): Root;
  getEffectiveBalanceIncrementsZeroInactive(): EffectiveBalanceIncrements;
  isExecutionStateType(): boolean;
  isExecutionEnabled(block: BeaconBlock | BlindedBeaconBlock): boolean;
  isMergeTransitionComplete(): boolean;
  getBalance(index: number): number;
  getFinalizedRootProof(): Uint8Array[];
  computeUnrealizedCheckpoints(): {
    justifiedCheckpoint: phase0.Checkpoint;
    finalizedCheckpoint: phase0.Checkpoint;
  };
  getExpectedWithdrawals(fork: ForkSeq): {
    expectedWithdrawals: capella.Withdrawal[];
    processedBuilderWithdrawalsCount: number;
    processedPartialWithdrawalsCount: number;
    processedValidatorSweepCount: number;
  };
  getRandaoMix(epoch: Epoch): Bytes32;
  computeBlockRewards(block: BeaconBlock, proposerRewards?: RewardCache): Promise<rewards.BlockRewards>;
  computeAttestationsRewards(validatorIds?: (ValidatorIndex | string)[]): Promise<rewards.AttestationsRewards>;
  computeSyncCommitteeRewards(
    block: BeaconBlock,
    validatorIds: (ValidatorIndex | string)[]
  ): Promise<rewards.SyncCommitteeRewards>;
  getVoluntaryExitValidity(
    fork: ForkSeq,
    signedVoluntaryExit: phase0.SignedVoluntaryExit,
    verifySignature: boolean
  ): VoluntaryExitValidity;
  isValidVoluntaryExit(
    fork: ForkSeq,
    signedVoluntaryExit: phase0.SignedVoluntaryExit,
    verifySignature: boolean
  ): boolean;
  getSyncCommitteesWitness(fork: ForkName): SyncCommitteeWitness;
  getSingleProof(gindex: bigint): Uint8Array[];
  createMultiProof(descriptor: Uint8Array): CompactMultiProof;
  getLatestWeakSubjectivityCheckpointEpoch(): Epoch;
  getHistoricalSummaries(): capella.HistoricalSummaries;
  getPendingDeposits(): electra.PendingDeposits;
  getPendingPartialWithdrawals(): electra.PendingPartialWithdrawals;
  getPendingConsolidations(): electra.PendingConsolidations;
  getProposerLookahead(): fulu.ProposerLookahead;
}
