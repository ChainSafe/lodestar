import {CompactMultiProof, ProofType, Tree, createProof} from "@chainsafe/persistent-merkle-tree";
import {BitArray, ByteViews} from "@chainsafe/ssz";
import {BeaconConfig} from "@lodestar/config";
import {ForkName, ForkSeq, SLOTS_PER_HISTORICAL_ROOT, isForkPostGloas} from "@lodestar/params";
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
  SyncCommittee,
  ValidatorIndex,
  capella,
  electra,
  fulu,
  getValidatorStatus,
  gloas,
  mapToGeneralStatus,
  phase0,
  rewards,
} from "@lodestar/types";
import {Checkpoint, Fork} from "@lodestar/types/phase0";
import {processExecutionPayloadEnvelope} from "../block/index.js";
import {ProcessExecutionPayloadEnvelopeOpts} from "../block/processExecutionPayloadEnvelope.js";
import {VoluntaryExitValidity, getVoluntaryExitValidity} from "../block/processVoluntaryExit.js";
import {getExpectedWithdrawals} from "../block/processWithdrawals.js";
import {EffectiveBalanceIncrements} from "../cache/effectiveBalanceIncrements.js";
import {EpochTransitionCacheOpts} from "../cache/epochTransitionCache.js";
import {PubkeyCache, createPubkeyCache} from "../cache/pubkeyCache.js";
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
import {getFinalizedRootProof, getSyncCommitteesWitness} from "../lightClient/proofs.js";
import {SyncCommitteeWitness} from "../lightClient/types.js";
import {computeAttestationsRewards} from "../rewards/attestationsRewards.js";
import {computeBlockRewards} from "../rewards/blockRewards.js";
import {computeSyncCommitteeRewards} from "../rewards/syncCommitteeRewards.js";
import {StateTransitionModules, StateTransitionOpts, processSlots, stateTransition} from "../stateTransition.js";
import {getEffectiveBalanceIncrementsZeroInactive} from "../util/balance.js";
import {getBlockRootAtSlot} from "../util/blockRoot.js";
import {computeAnchorCheckpoint} from "../util/computeAnchorCheckpoint.js";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "../util/epoch.js";
import {EpochShuffling} from "../util/epochShuffling.js";
import {isExecutionEnabled, isExecutionStateType, isMergeTransitionComplete} from "../util/execution.js";
import {canBuilderCoverBid} from "../util/gloas.js";
import {loadState} from "../util/loadState/loadState.js";
import {getRandaoMix} from "../util/seed.js";
import {getStateTypeFromBytes} from "../util/sszBytes.js";
import {getLatestWeakSubjectivityCheckpointEpoch} from "../util/weakSubjectivity.js";
import {IBeaconStateView} from "./interface.js";

export class BeaconStateView implements IBeaconStateView {
  private readonly config: BeaconConfig;
  // Cached values extracted from the tree
  // phase0
  private _fork: Fork | null = null;
  private _latestBlockHeader: phase0.BeaconBlockHeader | null = null;
  // altair
  private _currentSyncCommittee: SyncCommittee | null = null;
  private _nextSyncCommittee: SyncCommittee | null = null;
  private _previousEpochParticipation: Uint8Array | null = null;
  private _currentEpochParticipation: Uint8Array | null = null;
  // bellatrix
  private _latestExecutionPayloadHeader: ExecutionPayloadHeader | null = null;
  // Caches the cross-fork latestBlockHash value
  private _latestBlockHash: Bytes32 | null = null;
  // capella
  private _historicalSummaries: capella.HistoricalSummaries | null = null;
  // electra
  private _pendingPartialWithdrawals: electra.PendingPartialWithdrawals | null = null;
  private _pendingConsolidations: electra.PendingConsolidations | null = null;
  private _pendingDeposits: electra.PendingDeposits | null = null;
  // fulu
  private _proposerLookahead: fulu.ProposerLookahead | null = null;
  // gloas
  private _executionPayloadAvailability: BitArray | null = null;
  private _latestExecutionPayloadBid: ExecutionPayloadBid | null = null;

  constructor(readonly cachedState: CachedBeaconStateAllForks) {
    this.config = cachedState.config;
  }

  // phase0

  get forkName(): ForkName {
    return this.config.getForkName(this.cachedState.slot);
  }

  get slot(): number {
    return this.cachedState.slot;
  }

  get fork(): Fork {
    if (this._fork === null) {
      this._fork = this.cachedState.fork.toValue();
    }
    return this._fork;
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
    if (this._latestBlockHeader === null) {
      this._latestBlockHeader = this.cachedState.latestBlockHeader.toValue();
    }
    return this._latestBlockHeader;
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

  getBlockRootAtSlot(slot: Slot): Root {
    return getBlockRootAtSlot(this.cachedState, slot);
  }

  getBlockRootAtEpoch(epoch: Epoch): Root {
    return this.getBlockRootAtSlot(computeStartSlotAtEpoch(epoch));
  }

  getStateRootAtSlot(slot: Slot): Root {
    return this.cachedState.stateRoots.get(slot % SLOTS_PER_HISTORICAL_ROOT);
  }

  getRandaoMix(epoch: Epoch): Bytes32 {
    return getRandaoMix(this.cachedState, epoch);
  }

  get previousEpochParticipation(): Uint8Array {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.altair) {
      throw new Error("previousEpochParticipation is not available before Altair");
    }

    if (this._previousEpochParticipation === null) {
      this._previousEpochParticipation = (
        this.cachedState as CachedBeaconStateAltair
      ).previousEpochParticipation.serialize();
    }

    return this._previousEpochParticipation;
  }

  // altair

  get currentEpochParticipation(): Uint8Array {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.altair) {
      throw new Error("currentEpochParticipation is not available before Altair");
    }

    if (this._currentEpochParticipation === null) {
      this._currentEpochParticipation = (
        this.cachedState as CachedBeaconStateAltair
      ).currentEpochParticipation.serialize();
    }

    return this._currentEpochParticipation;
  }

  getPreviousEpochParticipation(validatorIndex: ValidatorIndex): number {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.altair) {
      throw new Error("previousEpochParticipation is not available before Altair");
    }
    return (this.cachedState as CachedBeaconStateAltair).previousEpochParticipation.get(validatorIndex);
  }

  getCurrentEpochParticipation(validatorIndex: ValidatorIndex): number {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.altair) {
      throw new Error("currentEpochParticipation is not available before Altair");
    }
    return (this.cachedState as CachedBeaconStateAltair).currentEpochParticipation.get(validatorIndex);
  }

  // bellatrix

  get latestExecutionPayloadHeader(): ExecutionPayloadHeader {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.bellatrix) {
      throw new Error("latestExecutionPayloadHeader is not available before Bellatrix");
    }

    if (this._latestExecutionPayloadHeader === null) {
      this._latestExecutionPayloadHeader = (
        this.cachedState as CachedBeaconStateExecutions
      ).latestExecutionPayloadHeader.toValue();
    }

    return this._latestExecutionPayloadHeader;
  }

  /**
   * Cross-fork accessor for the execution block hash of the most recently included payload.
   * Pre-gloas: reads from latestExecutionPayloadHeader.blockHash.
   * Gloas+: reads the dedicated latestBlockHash field (EIP-7732).
   */
  get latestBlockHash(): Bytes32 {
    const forkSeq = this.config.getForkSeq(this.cachedState.slot);
    if (forkSeq < ForkSeq.bellatrix) {
      throw new Error("latestBlockHash is not available before Bellatrix");
    }

    if (this._latestBlockHash === null) {
      if (forkSeq >= ForkSeq.gloas) {
        this._latestBlockHash = (this.cachedState as CachedBeaconStateGloas).latestBlockHash;
      } else {
        this._latestBlockHash = (
          this.cachedState as CachedBeaconStateExecutions
        ).latestExecutionPayloadHeader.blockHash;
      }
    }

    return this._latestBlockHash;
  }

  /**
   * The execution block number of the most recently included payload.
   * Named payloadBlockNumber (not latestBlockNumber) to mirror ExecutionPayloadHeader.blockNumber pre-gloas.
   * Only available from bellatrix through fulu — not tracked on BeaconState in gloas+ (EIP-7732).
   */
  get payloadBlockNumber(): number {
    const forkSeq = this.config.getForkSeq(this.cachedState.slot);
    if (forkSeq < ForkSeq.bellatrix) {
      throw new Error("payloadBlockNumber is not available before Bellatrix");
    }
    if (forkSeq >= ForkSeq.gloas) {
      throw new Error("payloadBlockNumber is not available post-gloas");
    }
    return (this.cachedState as CachedBeaconStateExecutions).latestExecutionPayloadHeader.blockNumber;
  }

  // capella

  get historicalSummaries(): capella.HistoricalSummaries {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.capella) {
      throw new Error("Historical summaries are not supported before Capella");
    }

    if (this._historicalSummaries === null) {
      this._historicalSummaries = (this.cachedState as CachedBeaconStateCapella).historicalSummaries.toValue();
    }

    return this._historicalSummaries;
  }

  // electra

  get pendingDeposits(): electra.PendingDeposits {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.electra) {
      throw new Error("Pending deposits are not supported before Electra");
    }

    if (this._pendingDeposits === null) {
      this._pendingDeposits = (this.cachedState as CachedBeaconStateElectra).pendingDeposits.toValue();
    }

    return this._pendingDeposits;
  }

  get pendingDepositsCount(): number {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.electra) {
      throw new Error("Pending deposits are not supported before Electra");
    }

    return (this.cachedState as CachedBeaconStateElectra).pendingDeposits.length;
  }

  get pendingPartialWithdrawals(): electra.PendingPartialWithdrawals {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.electra) {
      throw new Error("Pending partial withdrawals are not supported before Electra");
    }

    if (this._pendingPartialWithdrawals === null) {
      this._pendingPartialWithdrawals = (
        this.cachedState as CachedBeaconStateElectra
      ).pendingPartialWithdrawals.toValue();
    }

    return this._pendingPartialWithdrawals;
  }

  get pendingPartialWithdrawalsCount(): number {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.electra) {
      throw new Error("Pending partial withdrawals are not supported before Electra");
    }

    return (this.cachedState as CachedBeaconStateElectra).pendingPartialWithdrawals.length;
  }

  get pendingConsolidations(): electra.PendingConsolidations {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.electra) {
      throw new Error("Pending consolidations are not supported before Electra");
    }

    if (this._pendingConsolidations === null) {
      this._pendingConsolidations = (this.cachedState as CachedBeaconStateElectra).pendingConsolidations.toValue();
    }

    return this._pendingConsolidations;
  }

  get pendingConsolidationsCount(): number {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.electra) {
      throw new Error("Pending consolidations are not supported before Electra");
    }

    return (this.cachedState as CachedBeaconStateElectra).pendingConsolidations.length;
  }

  // fulu

  get proposerLookahead(): fulu.ProposerLookahead {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.fulu) {
      throw new Error("Proposer lookahead is not supported before Fulu");
    }

    if (this._proposerLookahead === null) {
      this._proposerLookahead = (this.cachedState as CachedBeaconStateFulu).proposerLookahead.toValue();
    }

    return this._proposerLookahead;
  }

  // gloas

  get executionPayloadAvailability(): BitArray {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.gloas) {
      throw new Error("executionPayloadAvailability is not available before GLOAS");
    }

    if (this._executionPayloadAvailability === null) {
      this._executionPayloadAvailability = (
        this.cachedState as CachedBeaconStateGloas
      ).executionPayloadAvailability.toValue();
    }

    return this._executionPayloadAvailability;
  }

  get latestExecutionPayloadBid(): ExecutionPayloadBid {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.gloas) {
      throw new Error("latestExecutionPayloadBid is not available before GLOAS");
    }

    if (this._latestExecutionPayloadBid === null) {
      this._latestExecutionPayloadBid = (
        this.cachedState as CachedBeaconStateGloas
      ).latestExecutionPayloadBid.toValue();
    }
    return this._latestExecutionPayloadBid;
  }

  getBuilder(index: BuilderIndex): gloas.Builder {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.gloas) {
      throw new Error("Builders are not supported before GLOAS");
    }

    return (this.cachedState as CachedBeaconStateGloas).builders.getReadonly(index);
  }

  canBuilderCoverBid(builderIndex: BuilderIndex, bidAmount: number): boolean {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.gloas) {
      throw new Error("Builders are not supported before GLOAS");
    }

    return canBuilderCoverBid(this.cachedState as CachedBeaconStateGloas, builderIndex, bidAmount);
  }

  /**
   * Return the index of the validator in the PTC committee for the given slot.
   * return -1 if validator is not in the PTC committee for the given slot.
   */
  getIndexInPayloadTimelinessCommittee(validatorIndex: ValidatorIndex, slot: Slot): number {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.gloas) {
      throw new Error("PTC committees are not supported before GLOAS");
    }

    const ptcCommittee = (this.cachedState as CachedBeaconStateGloas).epochCtx.getPayloadTimelinessCommittee(slot);
    return ptcCommittee.indexOf(validatorIndex);
  }

  // Shuffling and committees

  getShufflingAtEpoch(epoch: Epoch): EpochShuffling {
    return this.cachedState.epochCtx.getShufflingAtEpoch(epoch);
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

  // Proposer shuffling

  get previousProposers(): ValidatorIndex[] | null {
    return this.cachedState.epochCtx.proposersPrevEpoch;
  }

  get currentProposers(): ValidatorIndex[] {
    return this.cachedState.epochCtx.getBeaconProposers();
  }

  get nextProposers(): ValidatorIndex[] {
    return this.cachedState.epochCtx.getBeaconProposersNextEpoch();
  }

  getBeaconProposer(slot: number): ValidatorIndex {
    return this.cachedState.epochCtx.getBeaconProposer(slot);
  }

  computeAnchorCheckpoint(): {checkpoint: phase0.Checkpoint; blockHeader: phase0.BeaconBlockHeader} {
    return computeAnchorCheckpoint(this.config, this.cachedState);
  }

  // Sync committees

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
      throw new Error("nextSyncCommittee is not available before Altair");
    }

    if (this._nextSyncCommittee === null) {
      this._nextSyncCommittee = (this.cachedState as CachedBeaconStateAltair).nextSyncCommittee.toValue();
    }

    return this._nextSyncCommittee;
  }

  get currentSyncCommitteeIndexed(): SyncCommitteeCache {
    return this.cachedState.epochCtx.currentSyncCommitteeIndexed;
  }

  get syncProposerReward(): number {
    return this.cachedState.epochCtx.syncProposerReward;
  }

  getIndexedSyncCommittee(slot: Slot): SyncCommitteeCache {
    return this.cachedState.epochCtx.getIndexedSyncCommittee(slot);
  }

  getIndexedSyncCommitteeAtEpoch(epoch: Epoch): SyncCommitteeCache {
    return this.cachedState.epochCtx.getIndexedSyncCommitteeAtEpoch(epoch);
  }

  // Validators and balances

  get effectiveBalanceIncrements(): EffectiveBalanceIncrements {
    return this.cachedState.epochCtx.effectiveBalanceIncrements;
  }

  getEffectiveBalanceIncrementsZeroInactive(): EffectiveBalanceIncrements {
    return getEffectiveBalanceIncrementsZeroInactive(this.cachedState);
  }

  getBalance(index: number): number {
    return this.cachedState.balances.get(index);
  }

  getValidator(index: ValidatorIndex): phase0.Validator {
    return this.cachedState.validators.getReadonly(index).toValue();
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

  get validatorCount(): number {
    return this.cachedState.validators.length;
  }

  get activeValidatorCount(): number {
    return this.cachedState.epochCtx.currentShuffling.activeIndices.length;
  }

  getAllValidators(): phase0.Validator[] {
    return this.cachedState.validators.getAllReadonlyValues();
  }

  getAllBalances(): number[] {
    return this.cachedState.balances.getAll();
  }

  // Merge

  get isExecutionStateType(): boolean {
    return this.config.getForkSeq(this.cachedState.slot) >= ForkSeq.bellatrix;
  }

  isExecutionEnabled(block: BeaconBlock | BlindedBeaconBlock): boolean {
    if (this.config.getForkSeq(this.cachedState.slot) < ForkSeq.bellatrix) {
      return false;
    }

    return isExecutionEnabled(this.cachedState as CachedBeaconStateExecutions, block);
  }

  get isMergeTransitionComplete(): boolean {
    return isExecutionStateType(this.cachedState) && isMergeTransitionComplete(this.cachedState);
  }

  // Block production

  getExpectedWithdrawals(): {
    expectedWithdrawals: capella.Withdrawal[];
    processedBuilderWithdrawalsCount: number;
    processedPartialWithdrawalsCount: number;
    processedBuildersSweepCount: number;
    processedValidatorSweepCount: number;
  } {
    const fork = this.config.getForkSeq(this.cachedState.slot);
    return getExpectedWithdrawals(
      fork,
      this.cachedState as CachedBeaconStateCapella | CachedBeaconStateElectra | CachedBeaconStateGloas
    );
  }

  // API

  get proposerRewards(): RewardCache {
    return this.cachedState.proposerRewards;
  }

  async computeBlockRewards(block: BeaconBlock, proposerRewards?: RewardCache): Promise<rewards.BlockRewards> {
    return computeBlockRewards(this.cachedState.config, block, this.cachedState, proposerRewards);
  }

  async computeAttestationsRewards(validatorIds?: (ValidatorIndex | string)[]): Promise<rewards.AttestationsRewards> {
    return computeAttestationsRewards(
      this.cachedState.config,
      this.cachedState.epochCtx.pubkeyCache,
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
      this.cachedState.epochCtx.pubkeyCache,
      block,
      this.cachedState,
      validatorIds
    );
  }

  getLatestWeakSubjectivityCheckpointEpoch(): Epoch {
    return getLatestWeakSubjectivityCheckpointEpoch(this.config, this.cachedState);
  }

  // Validation

  getVoluntaryExitValidity(
    signedVoluntaryExit: phase0.SignedVoluntaryExit,
    verifySignature = true
  ): VoluntaryExitValidity {
    const stateFork = this.config.getForkSeq(this.cachedState.slot);
    return getVoluntaryExitValidity(stateFork, this.cachedState, signedVoluntaryExit, verifySignature);
  }

  isValidVoluntaryExit(signedVoluntaryExit: phase0.SignedVoluntaryExit, verifySignature: boolean): boolean {
    return this.getVoluntaryExitValidity(signedVoluntaryExit, verifySignature) === VoluntaryExitValidity.valid;
  }

  // Proofs

  getFinalizedRootProof(): Uint8Array[] {
    return getFinalizedRootProof(this.cachedState);
  }

  getSyncCommitteesWitness(): SyncCommitteeWitness {
    const fork = this.config.getForkName(this.cachedState.slot);
    if (ForkSeq[fork] < ForkSeq.altair) {
      throw new Error("Sync committees witness is not available before Altair");
    }

    return getSyncCommitteesWitness(fork, this.cachedState);
  }

  getSingleProof(gindex: bigint): Uint8Array[] {
    return new Tree(this.cachedState.node).getSingleProof(gindex);
  }

  createMultiProof(descriptor: Uint8Array): CompactMultiProof {
    const stateNode = this.cachedState.node;
    return createProof(stateNode, {type: ProofType.compactMulti, descriptor}) as CompactMultiProof;
  }

  // Fork choice

  computeUnrealizedCheckpoints(): {
    justifiedCheckpoint: phase0.Checkpoint;
    finalizedCheckpoint: phase0.Checkpoint;
  } {
    return computeUnrealizedCheckpoints(this.cachedState);
  }

  // this is for backward compatible

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

  // Serialization

  loadOtherState(stateBytes: Uint8Array, seedValidatorsBytes?: Uint8Array): IBeaconStateView {
    const {state} = loadState(this.config, this.cachedState, stateBytes, seedValidatorsBytes);

    const cachedState = createCachedBeaconState(
      state,
      {
        config: this.config,
        // as of Feb 2026, it's not necessary to sync pubkey cache as it's shared across states in Lodestar
        pubkeyCache: this.cachedState.epochCtx.pubkeyCache,
      },
      {
        skipSyncPubkeys: true,
      }
    );

    // load all cache in order for consumers (usually regen.getState()) to process blocks faster
    cachedState.validators.getAllReadonlyValues();
    cachedState.balances.getAll();

    return new BeaconStateView(cachedState);
  }

  toValue(): BeaconState {
    return this.cachedState.toValue();
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

  // State transition

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

  processExecutionPayloadEnvelope(
    signedEnvelope: gloas.SignedExecutionPayloadEnvelope,
    opts?: ProcessExecutionPayloadEnvelopeOpts
  ): BeaconStateView {
    const fork = this.config.getForkName(this.cachedState.slot);
    if (!isForkPostGloas(fork)) {
      throw Error(`processExecutionPayloadEnvelope is only available for gloas+ forks, got fork=${fork}`);
    }
    const postPayloadState = processExecutionPayloadEnvelope(
      this.cachedState as CachedBeaconStateGloas,
      signedEnvelope,
      opts
    );
    return new BeaconStateView(postPayloadState);
  }
}

/**
 * Create BeaconStateView for historical state regen, this is called from a worker thread.
 */
export function createBeaconStateViewForHistoricalRegen(
  config: BeaconConfig,
  stateBytes: Uint8Array
): IBeaconStateView {
  const state = getStateTypeFromBytes(config, stateBytes).deserializeToViewDU(stateBytes);

  syncPubkeyCache(state, pubkeyCacheRegen);
  const cachedState = createCachedBeaconState(
    state,
    {
      config,
      pubkeyCache: pubkeyCacheRegen,
    },
    {
      skipSyncPubkeys: true,
    }
  );

  return new BeaconStateView(cachedState);
}

// this is reused for all historical state regens in the worker.
const pubkeyCacheRegen = createPubkeyCache();

/**
 * Populate a PubkeyIndexMap with any new entries based on a BeaconState
 */
function syncPubkeyCache(state: BeaconStateAllForks, pubkeyCache: PubkeyCache): void {
  // Get the validators sub tree once for all the loop

  const newCount = state.validators.length;
  for (let i = pubkeyCache.size; i < newCount; i++) {
    const pubkey = state.validators.getReadonly(i).pubkey;
    pubkeyCache.set(i, pubkey);
  }
}
