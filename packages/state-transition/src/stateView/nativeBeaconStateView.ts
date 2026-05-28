import {CompactMultiProof} from "@chainsafe/persistent-merkle-tree";
import {ByteViews} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
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
import {AbstractBeaconStateView} from "./abstractBeaconStateView.js";
import {
  IBeaconStateView,
  IBeaconStateViewGloas,
  IBeaconStateViewLatestFork,
  IBeaconStateViewNative,
  isStatePostGloas,
} from "./interface.js";

/**
 * Wraps a native binding (the auto-generated JS interface produced by a `.node`
 * file) and exposes it as a fully-conformant `IBeaconStateViewLatestFork`.
 *
 * The binding is typed `IBeaconStateViewNative` — identical to
 * `IBeaconStateViewLatestFork` except `executionPayloadAvailability` is a raw
 * `{uint8Array, bitLen}` POJO. `AbstractBeaconStateView` lifts that POJO back
 * to a `BitArray` so beacon-node consumers see no difference from the TS-side
 * `BeaconStateView`.
 *
 * Cached fields mirror `BeaconStateView`'s cached set so each binding access
 * crossing the JS/native boundary happens at most once per view instance.
 */
export class NativeBeaconStateView extends AbstractBeaconStateView implements IBeaconStateViewLatestFork {
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
  // capella
  private _historicalSummaries: capella.HistoricalSummaries | null = null;
  // electra
  private _pendingPartialWithdrawals: electra.PendingPartialWithdrawals | null = null;
  private _pendingConsolidations: electra.PendingConsolidations | null = null;
  private _pendingDeposits: electra.PendingDeposits | null = null;
  // fulu
  private _proposerLookahead: fulu.ProposerLookahead | null = null;
  // gloas (executionPayloadAvailability cache lives on AbstractBeaconStateView)
  private _latestExecutionPayloadBid: ExecutionPayloadBid | null = null;
  private _payloadExpectedWithdrawals: capella.Withdrawal[] | null = null;

  constructor(readonly binding: IBeaconStateViewNative) {
    super();
  }

  // Abstract member from AbstractBeaconStateView. The public BitArray getter
  // on the base class caches the lifted BitArray, so this just forwards the
  // raw POJO shape coming from the binding.
  protected get _executionPayloadAvailability(): {uint8Array: Uint8Array; bitLen: number} {
    return this.binding.executionPayloadAvailability;
  }

  // ─── phase0 ──────────────────────────────────────────────────────────────

  get forkName(): ForkName {
    return this.binding.forkName;
  }

  get slot(): Slot {
    return this.binding.slot;
  }

  get fork(): Fork {
    if (this._fork === null) {
      this._fork = this.binding.fork;
    }
    return this._fork;
  }

  get epoch(): Epoch {
    return this.binding.epoch;
  }

  get genesisTime(): number {
    return this.binding.genesisTime;
  }

  get genesisValidatorsRoot(): Root {
    return this.binding.genesisValidatorsRoot;
  }

  get eth1Data(): phase0.Eth1Data {
    return this.binding.eth1Data;
  }

  get latestBlockHeader(): phase0.BeaconBlockHeader {
    if (this._latestBlockHeader === null) {
      this._latestBlockHeader = this.binding.latestBlockHeader;
    }
    return this._latestBlockHeader;
  }

  get previousJustifiedCheckpoint(): Checkpoint {
    return this.binding.previousJustifiedCheckpoint;
  }

  get currentJustifiedCheckpoint(): Checkpoint {
    return this.binding.currentJustifiedCheckpoint;
  }

  get finalizedCheckpoint(): Checkpoint {
    return this.binding.finalizedCheckpoint;
  }

  getBlockRootAtSlot(slot: Slot): Root {
    return this.binding.getBlockRootAtSlot(slot);
  }

  getBlockRootAtEpoch(epoch: Epoch): Root {
    return this.binding.getBlockRootAtEpoch(epoch);
  }

  getStateRootAtSlot(slot: Slot): Root {
    return this.binding.getStateRootAtSlot(slot);
  }

  getRandaoMix(epoch: Epoch): Bytes32 {
    return this.binding.getRandaoMix(epoch);
  }

  // Shuffling and committees

  getShufflingAtEpoch(epoch: Epoch): EpochShuffling {
    return this.binding.getShufflingAtEpoch(epoch);
  }

  get previousDecisionRoot(): RootHex {
    return this.binding.previousDecisionRoot;
  }

  get currentDecisionRoot(): RootHex {
    return this.binding.currentDecisionRoot;
  }

  get nextDecisionRoot(): RootHex {
    return this.binding.nextDecisionRoot;
  }

  getShufflingDecisionRoot(epoch: Epoch): RootHex {
    return this.binding.getShufflingDecisionRoot(epoch);
  }

  getPreviousShuffling(): EpochShuffling {
    return this.binding.getPreviousShuffling();
  }

  getCurrentShuffling(): EpochShuffling {
    return this.binding.getCurrentShuffling();
  }

  getNextShuffling(): EpochShuffling {
    return this.binding.getNextShuffling();
  }

  // Proposer shuffling

  get previousProposers(): ValidatorIndex[] | null {
    return this.binding.previousProposers;
  }

  get currentProposers(): ValidatorIndex[] {
    return this.binding.currentProposers;
  }

  get nextProposers(): ValidatorIndex[] {
    return this.binding.nextProposers;
  }

  getBeaconProposer(slot: Slot): ValidatorIndex {
    return this.binding.getBeaconProposer(slot);
  }

  getBeaconProposerOrNull(slot: Slot): ValidatorIndex | null {
    return this.binding.getBeaconProposerOrNull(slot);
  }

  // Validators and balances

  get effectiveBalanceIncrements(): EffectiveBalanceIncrements {
    return this.binding.effectiveBalanceIncrements;
  }

  getEffectiveBalanceIncrementsZeroInactive(): EffectiveBalanceIncrements {
    return this.binding.getEffectiveBalanceIncrementsZeroInactive();
  }

  getBalance(index: number): number {
    return this.binding.getBalance(index);
  }

  getValidator(index: ValidatorIndex): phase0.Validator {
    return this.binding.getValidator(index);
  }

  getValidatorsByStatus(statuses: Set<string>, currentEpoch: Epoch): phase0.Validator[] {
    return this.binding.getValidatorsByStatus(statuses, currentEpoch);
  }

  get validatorCount(): number {
    return this.binding.validatorCount;
  }

  get activeValidatorCount(): number {
    return this.binding.activeValidatorCount;
  }

  getAllValidators(): phase0.Validator[] {
    return this.binding.getAllValidators();
  }

  getAllBalances(): number[] {
    return this.binding.getAllBalances();
  }

  // API

  get proposerRewards(): RewardCache {
    return this.binding.proposerRewards;
  }

  computeBlockRewards(block: BeaconBlock, proposerRewards?: RewardCache): Promise<rewards.BlockRewards> {
    return this.binding.computeBlockRewards(block, proposerRewards);
  }

  computeAttestationsRewards(validatorIds?: (ValidatorIndex | string)[]): Promise<rewards.AttestationsRewards> {
    return this.binding.computeAttestationsRewards(validatorIds);
  }

  getLatestWeakSubjectivityCheckpointEpoch(): Epoch {
    return this.binding.getLatestWeakSubjectivityCheckpointEpoch();
  }

  // Validation

  getVoluntaryExitValidity(
    signedVoluntaryExit: phase0.SignedVoluntaryExit,
    verifySignature: boolean
  ): VoluntaryExitValidity {
    return this.binding.getVoluntaryExitValidity(signedVoluntaryExit, verifySignature);
  }

  isValidVoluntaryExit(signedVoluntaryExit: phase0.SignedVoluntaryExit, verifySignature: boolean): boolean {
    return this.binding.isValidVoluntaryExit(signedVoluntaryExit, verifySignature);
  }

  // Proofs

  getFinalizedRootProof(): Uint8Array[] {
    return this.binding.getFinalizedRootProof();
  }

  getSingleProof(gindex: bigint): Uint8Array[] {
    return this.binding.getSingleProof(gindex);
  }

  createMultiProof(descriptor: Uint8Array): CompactMultiProof {
    return this.binding.createMultiProof(descriptor);
  }

  // Fork choice

  computeUnrealizedCheckpoints(): {
    justifiedCheckpoint: phase0.Checkpoint;
    finalizedCheckpoint: phase0.Checkpoint;
  } {
    return this.binding.computeUnrealizedCheckpoints();
  }

  computeAnchorCheckpoint(): {checkpoint: phase0.Checkpoint; blockHeader: phase0.BeaconBlockHeader} {
    return this.binding.computeAnchorCheckpoint();
  }

  // Backward compatibility

  get clonedCount(): number {
    return this.binding.clonedCount;
  }

  get clonedCountWithTransferCache(): number {
    return this.binding.clonedCountWithTransferCache;
  }

  get createdWithTransferCache(): boolean {
    return this.binding.createdWithTransferCache;
  }

  isStateValidatorsNodesPopulated(): boolean {
    return this.binding.isStateValidatorsNodesPopulated();
  }

  // Serialization

  loadOtherState(
    stateBytes: Uint8Array,
    seedValidatorsBytes?: Uint8Array,
    opts?: {preloadValidatorsAndBalances?: boolean}
  ): IBeaconStateView {
    return new NativeBeaconStateView(this.binding.loadOtherState(stateBytes, seedValidatorsBytes, opts));
  }

  toValue(): BeaconState {
    return this.binding.toValue();
  }

  serialize(): Uint8Array {
    return this.binding.serialize();
  }

  serializedSize(): number {
    return this.binding.serializedSize();
  }

  serializeToBytes(output: ByteViews, offset: number): number {
    return this.binding.serializeToBytes(output, offset);
  }

  serializeValidators(): Uint8Array {
    return this.binding.serializeValidators();
  }

  serializedValidatorsSize(): number {
    return this.binding.serializedValidatorsSize();
  }

  serializeValidatorsToBytes(output: ByteViews, offset: number): number {
    return this.binding.serializeValidatorsToBytes(output, offset);
  }

  hashTreeRoot(): Uint8Array {
    return this.binding.hashTreeRoot();
  }

  // State transition

  stateTransition(
    signedBlock: SignedBeaconBlock | SignedBlindedBeaconBlock,
    options: StateTransitionOpts,
    modules: StateTransitionModules
  ): IBeaconStateView {
    return new NativeBeaconStateView(this.binding.stateTransition(signedBlock, options, modules));
  }

  processSlots(
    slot: Slot,
    epochTransitionCacheOpts?: EpochTransitionCacheOpts & {dontTransferCache?: boolean},
    modules?: StateTransitionModules
  ): IBeaconStateView {
    return new NativeBeaconStateView(this.binding.processSlots(slot, epochTransitionCacheOpts, modules));
  }

  // ─── altair ──────────────────────────────────────────────────────────────

  get previousEpochParticipation(): Uint8Array {
    if (this._previousEpochParticipation === null) {
      this._previousEpochParticipation = this.binding.previousEpochParticipation;
    }
    return this._previousEpochParticipation;
  }

  get currentEpochParticipation(): Uint8Array {
    if (this._currentEpochParticipation === null) {
      this._currentEpochParticipation = this.binding.currentEpochParticipation;
    }
    return this._currentEpochParticipation;
  }

  getPreviousEpochParticipation(validatorIndex: ValidatorIndex): number {
    return this.binding.getPreviousEpochParticipation(validatorIndex);
  }

  getCurrentEpochParticipation(validatorIndex: ValidatorIndex): number {
    return this.binding.getCurrentEpochParticipation(validatorIndex);
  }

  get currentSyncCommittee(): altair.SyncCommittee {
    if (this._currentSyncCommittee === null) {
      this._currentSyncCommittee = this.binding.currentSyncCommittee;
    }
    return this._currentSyncCommittee;
  }

  get nextSyncCommittee(): altair.SyncCommittee {
    if (this._nextSyncCommittee === null) {
      this._nextSyncCommittee = this.binding.nextSyncCommittee;
    }
    return this._nextSyncCommittee;
  }

  get currentSyncCommitteeIndexed(): SyncCommitteeCache {
    return this.binding.currentSyncCommitteeIndexed;
  }

  get syncProposerReward(): number {
    return this.binding.syncProposerReward;
  }

  getIndexedSyncCommitteeAtEpoch(epoch: Epoch): SyncCommitteeCache {
    return this.binding.getIndexedSyncCommitteeAtEpoch(epoch);
  }

  getIndexedSyncCommittee(slot: Slot): SyncCommitteeCache {
    return this.binding.getIndexedSyncCommittee(slot);
  }

  computeSyncCommitteeRewards(
    block: BeaconBlock,
    validatorIds: (ValidatorIndex | string)[]
  ): Promise<rewards.SyncCommitteeRewards> {
    return this.binding.computeSyncCommitteeRewards(block, validatorIds);
  }

  getSyncCommitteesWitness(): SyncCommitteeWitness {
    return this.binding.getSyncCommitteesWitness();
  }

  // ─── bellatrix ───────────────────────────────────────────────────────────

  get latestExecutionPayloadHeader(): ExecutionPayloadHeader {
    if (this._latestExecutionPayloadHeader === null) {
      this._latestExecutionPayloadHeader = this.binding.latestExecutionPayloadHeader;
    }
    return this._latestExecutionPayloadHeader;
  }

  get payloadBlockNumber(): number {
    return this.binding.payloadBlockNumber;
  }

  get isExecutionStateType(): boolean {
    return this.binding.isExecutionStateType;
  }

  get isMergeTransitionComplete(): boolean {
    return this.binding.isMergeTransitionComplete;
  }

  isExecutionEnabled(block: BeaconBlock | BlindedBeaconBlock): boolean {
    return this.binding.isExecutionEnabled(block);
  }

  // ─── capella ─────────────────────────────────────────────────────────────

  get historicalSummaries(): capella.HistoricalSummaries {
    if (this._historicalSummaries === null) {
      this._historicalSummaries = this.binding.historicalSummaries;
    }
    return this._historicalSummaries;
  }

  getExpectedWithdrawals(): {
    expectedWithdrawals: capella.Withdrawal[];
    processedBuilderWithdrawalsCount: number;
    processedPartialWithdrawalsCount: number;
    processedBuildersSweepCount: number;
    processedValidatorSweepCount: number;
  } {
    return this.binding.getExpectedWithdrawals();
  }

  // ─── electra ─────────────────────────────────────────────────────────────

  get pendingDeposits(): electra.PendingDeposits {
    if (this._pendingDeposits === null) {
      this._pendingDeposits = this.binding.pendingDeposits;
    }
    return this._pendingDeposits;
  }

  get pendingDepositsCount(): number {
    return this.binding.pendingDepositsCount;
  }

  get pendingPartialWithdrawals(): electra.PendingPartialWithdrawals {
    if (this._pendingPartialWithdrawals === null) {
      this._pendingPartialWithdrawals = this.binding.pendingPartialWithdrawals;
    }
    return this._pendingPartialWithdrawals;
  }

  get pendingPartialWithdrawalsCount(): number {
    return this.binding.pendingPartialWithdrawalsCount;
  }

  get pendingConsolidations(): electra.PendingConsolidations {
    if (this._pendingConsolidations === null) {
      this._pendingConsolidations = this.binding.pendingConsolidations;
    }
    return this._pendingConsolidations;
  }

  get pendingConsolidationsCount(): number {
    return this.binding.pendingConsolidationsCount;
  }

  // ─── fulu ────────────────────────────────────────────────────────────────

  get proposerLookahead(): fulu.ProposerLookahead {
    if (this._proposerLookahead === null) {
      this._proposerLookahead = this.binding.proposerLookahead;
    }
    return this._proposerLookahead;
  }

  // ─── gloas ───────────────────────────────────────────────────────────────

  get latestBlockHash(): Bytes32 {
    return this.binding.latestBlockHash;
  }

  // executionPayloadAvailability is inherited from AbstractBeaconStateView.

  get latestExecutionPayloadBid(): ExecutionPayloadBid {
    if (this._latestExecutionPayloadBid === null) {
      this._latestExecutionPayloadBid = this.binding.latestExecutionPayloadBid;
    }
    return this._latestExecutionPayloadBid;
  }

  get payloadExpectedWithdrawals(): capella.Withdrawal[] {
    if (this._payloadExpectedWithdrawals === null) {
      this._payloadExpectedWithdrawals = this.binding.payloadExpectedWithdrawals;
    }
    return this._payloadExpectedWithdrawals;
  }

  getBuilder(index: BuilderIndex): gloas.Builder {
    return this.binding.getBuilder(index);
  }

  canBuilderCoverBid(builderIndex: BuilderIndex, bidAmount: number): boolean {
    return this.binding.canBuilderCoverBid(builderIndex, bidAmount);
  }

  getEpochPTCs(epoch: Epoch): Uint32Array[] {
    return this.binding.getEpochPTCs(epoch);
  }

  getIndicesInPayloadTimelinessCommittee(validatorIndex: ValidatorIndex, slot: Slot): number[] {
    return this.binding.getIndicesInPayloadTimelinessCommittee(validatorIndex, slot);
  }

  withParentPayloadApplied(executionRequests: electra.ExecutionRequests): IBeaconStateViewGloas {
    const view = new NativeBeaconStateView(this.binding.withParentPayloadApplied(executionRequests));
    if (!isStatePostGloas(view)) {
      throw new Error("Expected gloas state from withParentPayloadApplied");
    }
    return view;
  }
}
