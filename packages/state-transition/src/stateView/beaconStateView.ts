import {CompactMultiProof, ProofType, Tree, createProof} from "@chainsafe/persistent-merkle-tree";
import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {ByteViews} from "@chainsafe/ssz";
import {BeaconConfig} from "@lodestar/config";
import {FINALIZED_ROOT_GINDEX, FINALIZED_ROOT_GINDEX_ELECTRA, ForkName, ForkSeq} from "@lodestar/params";
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
  SyncCommittee,
  ValidatorIndex,
  capella,
  electra,
  fulu,
  getValidatorStatus,
  mapToGeneralStatus,
  phase0,
  rewards,
} from "@lodestar/types";
import {Checkpoint, Fork} from "@lodestar/types/phase0";
import {VoluntaryExitValidity, getVoluntaryExitValidity} from "../block/processVoluntaryExit.js";
import {getExpectedWithdrawals} from "../block/processWithdrawals.js";
import {EffectiveBalanceIncrements} from "../cache/effectiveBalanceIncrements.js";
import {EpochTransitionCacheOpts} from "../cache/epochTransitionCache.js";
import {RewardCache} from "../cache/rewardCache.js";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStateAltair,
  CachedBeaconStateCapella,
  CachedBeaconStateElectra,
  CachedBeaconStateExecutions,
  CachedBeaconStateFulu,
  CachedBeaconStateGloas,
  createCachedBeaconState,
  isStateValidatorsNodesPopulated,
} from "../cache/stateCache.js";
import {SyncCommitteeCache} from "../cache/syncCommitteeCache.js";
import {BeaconStateAllForks} from "../cache/types.js";
import {computeUnrealizedCheckpoints} from "../epoch/computeUnrealizedCheckpoints.js";
import {getSyncCommitteesWitness} from "../lightClient/proofs.js";
import {SyncCommitteeWitness} from "../lightClient/types.js";
import {computeAttestationsRewards} from "../rewards/attestationsRewards.js";
import {computeBlockRewards} from "../rewards/blockRewards.js";
import {computeSyncCommitteeRewards} from "../rewards/syncCommitteeRewards.js";
import {StateTransitionModules, StateTransitionOpts, processSlots, stateTransition} from "../stateTransition.js";
import {getEffectiveBalanceIncrementsZeroInactive} from "../util/balance.js";
import {getBlockRoot, getBlockRootAtSlot} from "../util/blockRoot.js";
import {computeEpochAtSlot} from "../util/epoch.js";
import {EpochShuffling} from "../util/epochShuffling.js";
import {isExecutionEnabled, isExecutionStateType, isMergeTransitionComplete} from "../util/execution.js";
import {loadState} from "../util/loadState/loadState.js";
import {getRandaoMix} from "../util/seed.js";
import {getStateTypeFromBytes} from "../util/sszBytes.js";
import {getLatestWeakSubjectivityCheckpointEpoch} from "../util/weakSubjectivity.js";
import {IBeaconStateView} from "./interface.js";

export class BeaconStateView implements IBeaconStateView {
  private readonly config: BeaconConfig;
  private _executionPayloadAvailability: boolean[] | null = null;
  private _currentSyncCommittee: SyncCommittee | null = null;
  private _nextSyncCommittee: SyncCommittee | null = null;
  private _previousEpochParticipation: number[] | null = null;
  private _currentEpochParticipation: number[] | null = null;

  constructor(readonly cachedState: CachedBeaconStateAllForks) {
    this.config = cachedState.config;
  }

  get slot(): number {
    return this.cachedState.slot;
  }

  get fork(): Fork {
    return this.cachedState.fork.toValue();
  }

  get epoch(): number {
    return computeEpochAtSlot(this.slot);
  }

  get genesisTime(): number {
    return this.cachedState.genesisTime;
  }

  get genesisValidatorsRoot(): Root {
    return this.cachedState.genesisValidatorsRoot;
  }

  get eth1Data(): phase0.Eth1Data {
    return this.cachedState.eth1Data;
  }

  get latestBlockHeader(): phase0.BeaconBlockHeader {
    return this.cachedState.latestBlockHeader;
  }

  get previousDecisionRoot(): RootHex {
    return this.cachedState.epochCtx.previousDecisionRoot;
  }

  get currentDecisionRoot(): RootHex {
    return this.cachedState.epochCtx.currentDecisionRoot;
  }

  get nextDecisionRoot(): RootHex {
    return this.cachedState.epochCtx.nextDecisionRoot;
  }

  get previousJustifiedCheckpoint(): Checkpoint {
    return this.cachedState.previousJustifiedCheckpoint;
  }

  get currentJustifiedCheckpoint(): Checkpoint {
    return this.cachedState.currentJustifiedCheckpoint;
  }

  get finalizedCheckpoint(): Checkpoint {
    return this.cachedState.finalizedCheckpoint;
  }

  get proposers(): ValidatorIndex[] {
    return this.cachedState.epochCtx.proposers;
  }

  get proposersNextEpoch(): ValidatorIndex[] {
    const {proposersNextEpoch} = this.cachedState.epochCtx;
    if (!proposersNextEpoch.computed) {
      // never happen
      throw new Error("proposersNextEpoch is not computed");
    }

    return proposersNextEpoch.indexes;
  }

  get currentSyncCommittee(): SyncCommittee {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.altair) {
      throw new Error("currentSyncCommittee is not available before Altair");
    }

    if (this._currentSyncCommittee === null) {
      this._currentSyncCommittee = (this.cachedState as CachedBeaconStateAltair).currentSyncCommittee.toValue();
    }

    return this._currentSyncCommittee;
  }

  get nextSyncCommittee(): SyncCommittee {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.altair) {
      throw new Error("currentSyncCommittee is not available before Altair");
    }

    if (this._nextSyncCommittee === null) {
      this._nextSyncCommittee = (this.cachedState as CachedBeaconStateAltair).nextSyncCommittee.toValue();
    }

    return this._nextSyncCommittee;
  }

  get currentSyncCommitteeIndexed(): SyncCommitteeCache {
    return this.cachedState.epochCtx.currentSyncCommitteeIndexed;
  }

  get proposersPrevEpoch(): ValidatorIndex[] | null {
    return this.cachedState.epochCtx.proposersPrevEpoch;
  }

  get effectiveBalanceIncrements(): EffectiveBalanceIncrements {
    return this.cachedState.epochCtx.effectiveBalanceIncrements;
  }

  get latestExecutionPayloadHeader(): ExecutionPayloadHeader {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.bellatrix) {
      throw new Error("latestExecutionPayloadHeader is not available before Bellatrix");
    }

    return (this.cachedState as CachedBeaconStateExecutions).latestExecutionPayloadHeader;
  }

  get syncProposerReward(): number {
    return this.cachedState.epochCtx.syncProposerReward;
  }

  get previousEpochParticipation(): number[] {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.altair) {
      throw new Error("previousEpochParticipation is not available before Altair");
    }

    if (this._previousEpochParticipation === null) {
      this._previousEpochParticipation = (
        this.cachedState as CachedBeaconStateAltair
      ).previousEpochParticipation.toValue();
    }

    return this._previousEpochParticipation;
  }

  get currentEpochParticipation(): number[] {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.altair) {
      throw new Error("currentEpochParticipation is not available before Altair");
    }

    if (this._currentEpochParticipation === null) {
      this._currentEpochParticipation = (
        this.cachedState as CachedBeaconStateAltair
      ).currentEpochParticipation.toValue();
    }

    return this._currentEpochParticipation;
  }

  get executionPayloadAvailability(): boolean[] {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.gloas) {
      throw new Error("executionPayloadAvailability is not available before GLOAS");
    }

    if (this._executionPayloadAvailability === null) {
      this._executionPayloadAvailability = (this.cachedState as CachedBeaconStateGloas).executionPayloadAvailability
        .toValue()
        .toBoolArray();
    }

    return this._executionPayloadAvailability;
  }

  get proposerRewards(): RewardCache {
    return this.cachedState.proposerRewards;
  }

  get pendingDepositsLength(): number {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.electra) {
      throw new Error("pendingDepositsLength is not available before Electra");
    }

    return (this.cachedState as CachedBeaconStateElectra).pendingDeposits.length;
  }

  get pendingPartialWithdrawalsLength(): number {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.electra) {
      throw new Error("pendingPartialWithdrawalsLength is not available before Electra");
    }

    return (this.cachedState as CachedBeaconStateElectra).pendingPartialWithdrawals.length;
  }

  get pendingConsolidationsLength(): number {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.electra) {
      throw new Error("pendingConsolidationsLength is not available before Electra");
    }

    return (this.cachedState as CachedBeaconStateElectra).pendingConsolidations.length;
  }

  get clonedCount(): number {
    return this.cachedState.clonedCount;
  }

  get clonedCountWithTransferCache(): number {
    return this.cachedState.clonedCountWithTransferCache;
  }

  get createdWithTransferCache(): boolean {
    return this.cachedState.createdWithTransferCache;
  }

  isStateValidatorsNodesPopulated(): boolean {
    return isStateValidatorsNodesPopulated(this.cachedState);
  }

  serialize(): Uint8Array {
    return this.cachedState.serialize();
  }

  serializedSize(): number {
    return this.cachedState.type.tree_serializedSize(this.cachedState.node);
  }

  serializeToBytes(output: ByteViews, offset: number): number {
    return this.cachedState.serializeToBytes(output, offset);
  }

  serializeValidators(): Uint8Array {
    return this.cachedState.validators.serialize();
  }

  serializedValidatorsSize(): number {
    const type = this.cachedState.type.fields.validators;
    return type.tree_serializedSize(this.cachedState.validators.node);
  }

  serializeValidatorsToBytes(output: ByteViews, offset: number): number {
    return this.cachedState.validators.serializeToBytes(output, offset);
  }

  hashTreeRoot(): Uint8Array {
    return this.cachedState.hashTreeRoot();
  }

  stateTransition(
    signedBlock: SignedBeaconBlock | SignedBlindedBeaconBlock,
    options: StateTransitionOpts,
    {metrics, validatorMonitor}: StateTransitionModules
  ): IBeaconStateView {
    const newState = stateTransition(this.cachedState, signedBlock, options, {metrics, validatorMonitor});
    return new BeaconStateView(newState);
  }

  processSlots(
    slot: Slot,
    epochTransitionCacheOpts?: EpochTransitionCacheOpts & {dontTransferCache?: boolean},
    modules?: StateTransitionModules
  ): IBeaconStateView {
    const newState = processSlots(this.cachedState, slot, epochTransitionCacheOpts, modules);
    return new BeaconStateView(newState);
  }

  loadOtherState(stateBytes: Uint8Array, seedValidatorsBytes?: Uint8Array): IBeaconStateView {
    const {state} = loadState(this.config, this.cachedState, stateBytes, seedValidatorsBytes);
    return new BeaconStateView(
      createCachedBeaconState(
        state,
        {
          config: this.config,
          pubkey2index: this.cachedState.epochCtx.pubkey2index,
          index2pubkey: this.cachedState.epochCtx.index2pubkey,
        },
        {
          skipSyncPubkeys: true,
        }
      )
    );
  }

  getValidator(index: ValidatorIndex): phase0.Validator {
    return this.cachedState.validators.getReadonly(index);
  }

  getValidatorsByStatus(statuses: Set<string>, currentEpoch: Epoch): phase0.Validator[] {
    const validators: phase0.Validator[] = [];
    const validatorsArr = this.cachedState.validators.getAllReadonlyValues();

    for (const validator of validatorsArr) {
      const validatorStatus = getValidatorStatus(validator, currentEpoch);
      if (statuses.has(validatorStatus) || statuses.has(mapToGeneralStatus(validatorStatus))) {
        validators.push(validator);
      }
    }
    return validators;
  }

  getValidatorCount(): number {
    return this.cachedState.validators.length;
  }

  getActiveValidatorCount(): number {
    return this.cachedState.epochCtx.currentShuffling.activeIndices.length;
  }

  getBeaconProposer(slot: number): ValidatorIndex {
    return this.cachedState.epochCtx.getBeaconProposer(slot);
  }

  getBeaconProposers(): ValidatorIndex[] {
    return this.cachedState.epochCtx.getBeaconProposers();
  }

  getBeaconProposersPrevEpoch(): ValidatorIndex[] | null {
    return this.cachedState.epochCtx.getBeaconProposersPrevEpoch();
  }

  getBeaconProposersNextEpoch(): ValidatorIndex[] {
    return this.cachedState.epochCtx.getBeaconProposersNextEpoch();
  }

  getShufflingDecisionRoot(epoch: Epoch): RootHex {
    return this.cachedState.epochCtx.getShufflingDecisionRoot(epoch);
  }

  getPreviousShuffling(): EpochShuffling {
    return this.cachedState.epochCtx.previousShuffling;
  }

  getCurrentShuffling(): EpochShuffling {
    return this.cachedState.epochCtx.currentShuffling;
  }

  getNextShuffling(): EpochShuffling {
    return this.cachedState.epochCtx.nextShuffling;
  }

  getShufflingAtEpoch(epoch: Epoch): EpochShuffling {
    return this.cachedState.epochCtx.getShufflingAtEpoch(epoch);
  }

  getIndexedSyncCommitteeAtEpoch(epoch: Epoch): SyncCommitteeCache {
    return this.cachedState.epochCtx.getIndexedSyncCommitteeAtEpoch(epoch);
  }

  getBlockRootAtSlot(slot: Slot): Root {
    return getBlockRootAtSlot(this.cachedState, slot);
  }

  getBlockRoot(epoch: Epoch): Root {
    return getBlockRoot(this.cachedState, epoch);
  }

  getEffectiveBalanceIncrementsZeroInactive(): EffectiveBalanceIncrements {
    return getEffectiveBalanceIncrementsZeroInactive(this.cachedState);
  }

  isExecutionStateType(): boolean {
    return this.config.getForkSeq(this.cachedState.slot) >= ForkSeq.bellatrix;
  }

  isExecutionEnabled(block: BeaconBlock | BlindedBeaconBlock): boolean {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.bellatrix) {
      return false;
    }

    return isExecutionEnabled(this.cachedState as CachedBeaconStateExecutions, block);
  }

  isMergeTransitionComplete(): boolean {
    return isExecutionStateType(this.cachedState) && isMergeTransitionComplete(this.cachedState);
  }

  getBalance(index: number): number {
    return this.cachedState.balances.get(index);
  }

  getFinalizedRootProof(): Uint8Array[] {
    const finalizedRootGindex = this.cachedState.epochCtx.isPostElectra()
      ? FINALIZED_ROOT_GINDEX_ELECTRA
      : FINALIZED_ROOT_GINDEX;
    return new Tree(this.cachedState.node).getSingleProof(BigInt(finalizedRootGindex));
  }

  computeUnrealizedCheckpoints(): {
    justifiedCheckpoint: phase0.Checkpoint;
    finalizedCheckpoint: phase0.Checkpoint;
  } {
    return computeUnrealizedCheckpoints(this.cachedState);
  }

  getExpectedWithdrawals(fork: ForkSeq): {
    expectedWithdrawals: capella.Withdrawal[];
    processedBuilderWithdrawalsCount: number;
    processedPartialWithdrawalsCount: number;
    processedValidatorSweepCount: number;
  } {
    return getExpectedWithdrawals(
      fork,
      this.cachedState as CachedBeaconStateCapella | CachedBeaconStateElectra | CachedBeaconStateGloas
    );
  }

  getRandaoMix(epoch: Epoch): Bytes32 {
    return getRandaoMix(this.cachedState, epoch);
  }

  async computeBlockRewards(block: BeaconBlock, proposerRewards?: RewardCache): Promise<rewards.BlockRewards> {
    return computeBlockRewards(this.cachedState.config, block, this.cachedState, proposerRewards);
  }

  async computeAttestationsRewards(validatorIds?: (ValidatorIndex | string)[]): Promise<rewards.AttestationsRewards> {
    return computeAttestationsRewards(
      this.cachedState.config,
      this.cachedState.epochCtx.pubkey2index,
      this.cachedState,
      validatorIds
    );
  }

  async computeSyncCommitteeRewards(
    block: BeaconBlock,
    validatorIds: (ValidatorIndex | string)[]
  ): Promise<rewards.SyncCommitteeRewards> {
    return computeSyncCommitteeRewards(
      this.cachedState.config,
      this.cachedState.epochCtx.index2pubkey,
      block,
      this.cachedState,
      validatorIds
    );
  }

  getVoluntaryExitValidity(
    fork: ForkSeq,
    signedVoluntaryExit: phase0.SignedVoluntaryExit,
    verifySignature = true
  ): VoluntaryExitValidity {
    return getVoluntaryExitValidity(fork, this.cachedState, signedVoluntaryExit, verifySignature);
  }

  isValidVoluntaryExit(
    fork: ForkSeq,
    signedVoluntaryExit: phase0.SignedVoluntaryExit,
    verifySignature: boolean
  ): boolean {
    return this.getVoluntaryExitValidity(fork, signedVoluntaryExit, verifySignature) === VoluntaryExitValidity.valid;
  }

  getSyncCommitteesWitness(fork: ForkName): SyncCommitteeWitness {
    return getSyncCommitteesWitness(fork, this.cachedState);
  }

  getSingleProof(gindex: bigint): Uint8Array[] {
    return new Tree(this.cachedState.node).getSingleProof(gindex);
  }

  createMultiProof(descriptor: Uint8Array): CompactMultiProof {
    const stateNode = this.cachedState.node;
    return createProof(stateNode, {type: ProofType.compactMulti, descriptor}) as CompactMultiProof;
  }

  getLatestWeakSubjectivityCheckpointEpoch(): Epoch {
    return getLatestWeakSubjectivityCheckpointEpoch(this.config, this.cachedState);
  }

  getHistoricalSummaries(): capella.HistoricalSummaries {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.capella) {
      throw new Error("Historical summaries are not supported before Capella");
    }

    return (this.cachedState as CachedBeaconStateCapella).historicalSummaries.toValue();
  }

  getPendingDeposits(): electra.PendingDeposits {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.electra) {
      throw new Error("Pending deposits are not supported before Electra");
    }

    return (this.cachedState as CachedBeaconStateElectra).pendingDeposits.toValue();
  }

  getPendingPartialWithdrawals(): electra.PendingPartialWithdrawals {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.electra) {
      throw new Error("Pending partial withdrawals are not supported before Electra");
    }

    return (this.cachedState as CachedBeaconStateElectra).pendingPartialWithdrawals.toValue();
  }

  getPendingConsolidations(): electra.PendingConsolidations {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.electra) {
      throw new Error("Pending consolidations are not supported before Electra");
    }

    return (this.cachedState as CachedBeaconStateElectra).pendingConsolidations.toValue();
  }

  getProposerLookahead(): fulu.ProposerLookahead {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.fulu) {
      throw new Error("Proposer lookahead is not supported before Fulu");
    }

    return (this.cachedState as CachedBeaconStateFulu).proposerLookahead.toValue();
  }
}

export function createBeaconStateViewForHistoricalRegen(
  config: BeaconConfig,
  stateBytes: Uint8Array
): IBeaconStateView {
  const state = getStateTypeFromBytes(config, stateBytes).deserializeToViewDU(stateBytes);

  const pubkey2index = new PubkeyIndexMap();
  // no need to populate index2pubkey for historical regen
  syncPubkeyCache(state, pubkey2index);
  const cachedState = createCachedBeaconState(
    state,
    {
      config,
      pubkey2index,
      index2pubkey: [],
    },
    {
      skipSyncPubkeys: true,
    }
  );

  return new BeaconStateView(cachedState);
}

/**
 * Populate a PubkeyIndexMap with any new entries based on a BeaconState
 */
function syncPubkeyCache(state: BeaconStateAllForks, pubkey2index: PubkeyIndexMap): void {
  // Get the validators sub tree once for all the loop

  const newCount = state.validators.length;
  for (let i = pubkey2index.size; i < newCount; i++) {
    const pubkey = state.validators.getReadonly(i).pubkey;
    pubkey2index.set(pubkey, i);
  }
}
