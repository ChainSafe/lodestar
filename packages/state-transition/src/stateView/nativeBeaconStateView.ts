import {CompactMultiProof} from "@chainsafe/persistent-merkle-tree";
import {BitArray, ByteViews} from "@chainsafe/ssz";
import type {BeaconConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
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
  SyncCommittee,
  ValidatorIndex,
  altair,
  capella,
  electra,
  fulu,
  gloas,
  isBlindedBeaconBlock,
  phase0,
  rewards,
  ssz,
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
import {
  IBeaconStateView,
  IBeaconStateViewGloas,
  IBeaconStateViewLatestFork,
  IBeaconStateViewNative,
} from "./interface.js";

/**
 * Wraps a native binding (the auto-generated JS interface produced by a `.node`
 * file) and exposes it as a fully-conformant `IBeaconStateViewLatestFork`.
 *
 * The binding is typed `IBeaconStateViewNative` — identical to
 * `IBeaconStateViewLatestFork` except `executionPayloadAvailability` is a raw
 * `{uint8Array, bitLen}` POJO. The `executionPayloadAvailability` getter lifts
 * that POJO back to a `BitArray` so beacon-node consumers see no difference from
 * the TS-side `BeaconStateView`.
 *
 * Every getter that returns a value stable for the view's lifetime is cached so
 * the binding is hit at most once per field per view. Only mutable counters
 * (`proposerRewards`, `clonedCount`, `clonedCountWithTransferCache`) stay
 * pass-through. Methods with arguments are pass-through too — caching them
 * would need a per-arg map and isn't worth it without a hot-path signal.
 */
export class NativeBeaconStateView implements IBeaconStateViewLatestFork {
  // phase0
  private _forkName: ForkName | null = null;
  private _slot: Slot | null = null;
  private _fork: Fork | null = null;
  private _epoch: Epoch | null = null;
  private _genesisTime: number | null = null;
  private _genesisValidatorsRoot: Root | null = null;
  private _eth1Data: phase0.Eth1Data | null = null;
  private _latestBlockHeader: phase0.BeaconBlockHeader | null = null;
  private _previousJustifiedCheckpoint: Checkpoint | null = null;
  private _currentJustifiedCheckpoint: Checkpoint | null = null;
  private _finalizedCheckpoint: Checkpoint | null = null;
  // shuffling / decision roots / proposers
  private _previousDecisionRoot: RootHex | null = null;
  private _currentDecisionRoot: RootHex | null = null;
  private _nextDecisionRoot: RootHex | null = null;
  // previousProposers can be null, so use undefined as the "not loaded" sentinel
  private _previousProposers: ValidatorIndex[] | null | undefined = undefined;
  private _currentProposers: ValidatorIndex[] | null = null;
  private _nextProposers: ValidatorIndex[] | null = null;
  // validators / balances
  private _effectiveBalanceIncrements: EffectiveBalanceIncrements | null = null;
  private _validatorCount: number | null = null;
  private _activeValidatorCount: number | null = null;
  // backward compat
  private _createdWithTransferCache: boolean | null = null;
  // altair
  private _currentSyncCommittee: SyncCommittee | null = null;
  private _nextSyncCommittee: SyncCommittee | null = null;
  private _previousEpochParticipation: Uint8Array | null = null;
  private _currentEpochParticipation: Uint8Array | null = null;
  private _currentSyncCommitteeIndexed: SyncCommitteeCache | null = null;
  private _syncProposerReward: number | null = null;
  // bellatrix
  private _latestExecutionPayloadHeader: ExecutionPayloadHeader | null = null;
  private _payloadBlockNumber: number | null = null;
  private _isExecutionStateType: boolean | null = null;
  private _isMergeTransitionComplete: boolean | null = null;
  // capella
  private _historicalSummaries: capella.HistoricalSummaries | null = null;
  // electra
  private _pendingPartialWithdrawals: electra.PendingPartialWithdrawals | null = null;
  private _pendingConsolidations: electra.PendingConsolidations | null = null;
  private _pendingDeposits: electra.PendingDeposits | null = null;
  private _pendingDepositsCount: number | null = null;
  private _pendingPartialWithdrawalsCount: number | null = null;
  private _pendingConsolidationsCount: number | null = null;
  // fulu
  private _proposerLookahead: fulu.ProposerLookahead | null = null;

  // Per-argument caches for argument-taking methods. The binding is treated as
  // immutable for the view's lifetime, so a given argument always yields the
  // same result. Maps grow only with touched arguments — typical call patterns
  // (e.g. a handful of slots per attestation pool scan) keep them tiny.
  private readonly _getBlockRootAtSlot = new Map<Slot, Root>();
  private readonly _getBlockRootAtEpoch = new Map<Epoch, Root>();
  private readonly _getStateRootAtSlot = new Map<Slot, Root>();
  private readonly _getRandaoMix = new Map<Epoch, Bytes32>();
  private readonly _getShufflingAtEpoch = new Map<Epoch, EpochShuffling>();
  private readonly _getBeaconCommittee = new Map<string, Uint32Array>();
  private readonly _getBeaconCommitteeCountPerSlot = new Map<Epoch, number>();
  private readonly _getShufflingDecisionRoot = new Map<Epoch, RootHex>();
  private readonly _getBeaconProposer = new Map<Slot, ValidatorIndex>();
  // getBeaconProposerOrNull can return null, so use .has() to distinguish "not cached" from "cached null"
  private readonly _getBeaconProposerOrNull = new Map<Slot, ValidatorIndex | null>();
  private readonly _getValidator = new Map<ValidatorIndex, phase0.Validator>();
  private readonly _getBalance = new Map<number, number>();
  private readonly _getIndexedSyncCommitteeAtEpoch = new Map<Epoch, SyncCommitteeCache>();
  private readonly _getIndexedSyncCommittee = new Map<Slot, SyncCommitteeCache>();
  private readonly _getSingleProof = new Map<bigint, Uint8Array[]>();
  // TODO(bing): add caches when native supports gloas
  // private readonly _getEpochPTCs = new Map<Epoch, Uint32Array[]>();
  // private readonly _getBuilder = new Map<BuilderIndex, gloas.Builder>();

  // No-arg method caches
  private _getPreviousShuffling: EpochShuffling | null = null;
  private _getCurrentShuffling: EpochShuffling | null = null;
  private _getNextShuffling: EpochShuffling | null = null;
  private _getEffectiveBalanceIncrementsZeroInactive: EffectiveBalanceIncrements | null = null;
  private _getAllValidators: phase0.Validator[] | null = null;
  private _getAllBalances: number[] | null = null;
  private _getLatestWeakSubjectivityCheckpointEpoch: Epoch | null = null;
  private _getFinalizedRootProof: Uint8Array[] | null = null;
  private _computeUnrealizedCheckpoints: {
    justifiedCheckpoint: phase0.Checkpoint;
    finalizedCheckpoint: phase0.Checkpoint;
  } | null = null;
  private _computeAnchorCheckpoint: {checkpoint: phase0.Checkpoint; blockHeader: phase0.BeaconBlockHeader} | null =
    null;
  private _isStateValidatorsNodesPopulated: boolean | null = null;
  private _toValue: BeaconState | null = null;
  private _serialize: Uint8Array | null = null;
  private _serializedSize: number | null = null;
  private _serializeValidators: Uint8Array | null = null;
  private _serializedValidatorsSize: number | null = null;
  private _hashTreeRoot: Uint8Array | null = null;
  private _getSyncCommitteesWitness: SyncCommitteeWitness | null = null;
  private _getExpectedWithdrawals: {
    expectedWithdrawals: capella.Withdrawal[];
    processedBuilderWithdrawalsCount: number;
    processedPartialWithdrawalsCount: number;
    processedBuildersSweepCount: number;
    processedValidatorSweepCount: number;
  } | null = null;

  constructor(
    readonly nativeView: IBeaconStateViewNative,
    private readonly config: BeaconConfig
  ) {}

  // Binding returns pojo object {uint8Array: Uint8Array; bitLen: number}
  // this class wrap it with BitArray to conform to the api
  get executionPayloadAvailability(): BitArray {
    throw new Error("NativeBeaconStateView does not support Gloas");
  }

  // ─── phase0 ──────────────────────────────────────────────────────────────

  get forkName(): ForkName {
    if (this._forkName === null) {
      this._forkName = this.nativeView.forkName;
    }
    return this._forkName;
  }

  get slot(): Slot {
    if (this._slot === null) {
      this._slot = this.nativeView.slot;
    }
    return this._slot;
  }

  get fork(): Fork {
    if (this._fork === null) {
      this._fork = this.nativeView.fork;
    }
    return this._fork;
  }

  get epoch(): Epoch {
    if (this._epoch === null) {
      this._epoch = this.nativeView.epoch;
    }
    return this._epoch;
  }

  get genesisTime(): number {
    if (this._genesisTime === null) {
      this._genesisTime = this.nativeView.genesisTime;
    }
    return this._genesisTime;
  }

  get genesisValidatorsRoot(): Root {
    if (this._genesisValidatorsRoot === null) {
      this._genesisValidatorsRoot = this.nativeView.genesisValidatorsRoot;
    }
    return this._genesisValidatorsRoot;
  }

  get eth1Data(): phase0.Eth1Data {
    if (this._eth1Data === null) {
      this._eth1Data = this.nativeView.eth1Data;
    }
    return this._eth1Data;
  }

  get latestBlockHeader(): phase0.BeaconBlockHeader {
    if (this._latestBlockHeader === null) {
      this._latestBlockHeader = this.nativeView.latestBlockHeader;
    }
    return this._latestBlockHeader;
  }

  get previousJustifiedCheckpoint(): Checkpoint {
    if (this._previousJustifiedCheckpoint === null) {
      this._previousJustifiedCheckpoint = this.nativeView.previousJustifiedCheckpoint;
    }
    return this._previousJustifiedCheckpoint;
  }

  get currentJustifiedCheckpoint(): Checkpoint {
    if (this._currentJustifiedCheckpoint === null) {
      this._currentJustifiedCheckpoint = this.nativeView.currentJustifiedCheckpoint;
    }
    return this._currentJustifiedCheckpoint;
  }

  get finalizedCheckpoint(): Checkpoint {
    if (this._finalizedCheckpoint === null) {
      this._finalizedCheckpoint = this.nativeView.finalizedCheckpoint;
    }
    return this._finalizedCheckpoint;
  }

  getBlockRootAtSlot(slot: Slot): Root {
    let cached = this._getBlockRootAtSlot.get(slot);
    if (cached === undefined) {
      cached = this.nativeView.getBlockRootAtSlot(slot);
      this._getBlockRootAtSlot.set(slot, cached);
    }
    return cached;
  }

  getBlockRootAtEpoch(epoch: Epoch): Root {
    let cached = this._getBlockRootAtEpoch.get(epoch);
    if (cached === undefined) {
      cached = this.nativeView.getBlockRootAtEpoch(epoch);
      this._getBlockRootAtEpoch.set(epoch, cached);
    }
    return cached;
  }

  getStateRootAtSlot(slot: Slot): Root {
    let cached = this._getStateRootAtSlot.get(slot);
    if (cached === undefined) {
      cached = this.nativeView.getStateRootAtSlot(slot);
      this._getStateRootAtSlot.set(slot, cached);
    }
    return cached;
  }

  getRandaoMix(epoch: Epoch): Bytes32 {
    let cached = this._getRandaoMix.get(epoch);
    if (cached === undefined) {
      cached = this.nativeView.getRandaoMix(epoch);
      this._getRandaoMix.set(epoch, cached);
    }
    return cached;
  }

  // Shuffling and committees

  getShufflingAtEpoch(epoch: Epoch): EpochShuffling {
    let cached = this._getShufflingAtEpoch.get(epoch);
    if (cached === undefined) {
      cached = this.nativeView.getShufflingAtEpoch(epoch);
      this._getShufflingAtEpoch.set(epoch, cached);
    }
    return cached;
  }

  getBeaconCommittee(slot: Slot, index: CommitteeIndex): Uint32Array {
    const key = `${slot}:${index}`;
    let cached = this._getBeaconCommittee.get(key);
    if (cached === undefined) {
      const committee = this.nativeView.getBeaconCommittee(slot, index);
      cached = committee instanceof Uint32Array ? committee : Uint32Array.from(committee);
      this._getBeaconCommittee.set(key, cached);
    }
    return cached;
  }

  getBeaconCommitteeCountPerSlot(epoch: Epoch): number {
    let cached = this._getBeaconCommitteeCountPerSlot.get(epoch);
    if (cached === undefined) {
      cached = this.nativeView.getBeaconCommitteeCountPerSlot(epoch);
      this._getBeaconCommitteeCountPerSlot.set(epoch, cached);
    }
    return cached;
  }

  get previousDecisionRoot(): RootHex {
    if (this._previousDecisionRoot === null) {
      this._previousDecisionRoot = this.nativeView.previousDecisionRoot;
    }
    return this._previousDecisionRoot;
  }

  get currentDecisionRoot(): RootHex {
    if (this._currentDecisionRoot === null) {
      this._currentDecisionRoot = this.nativeView.currentDecisionRoot;
    }
    return this._currentDecisionRoot;
  }

  get nextDecisionRoot(): RootHex {
    if (this._nextDecisionRoot === null) {
      this._nextDecisionRoot = this.nativeView.nextDecisionRoot;
    }
    return this._nextDecisionRoot;
  }

  getShufflingDecisionRoot(epoch: Epoch): RootHex {
    let cached = this._getShufflingDecisionRoot.get(epoch);
    if (cached === undefined) {
      cached = this.nativeView.getShufflingDecisionRoot(epoch);
      this._getShufflingDecisionRoot.set(epoch, cached);
    }
    return cached;
  }

  getPreviousShuffling(): EpochShuffling {
    if (this._getPreviousShuffling === null) {
      this._getPreviousShuffling = this.nativeView.getPreviousShuffling();
    }
    return this._getPreviousShuffling;
  }

  getCurrentShuffling(): EpochShuffling {
    if (this._getCurrentShuffling === null) {
      this._getCurrentShuffling = this.nativeView.getCurrentShuffling();
    }
    return this._getCurrentShuffling;
  }

  getNextShuffling(): EpochShuffling {
    if (this._getNextShuffling === null) {
      this._getNextShuffling = this.nativeView.getNextShuffling();
    }
    return this._getNextShuffling;
  }

  // Proposer shuffling

  get previousProposers(): ValidatorIndex[] | null {
    if (this._previousProposers === undefined) {
      this._previousProposers = this.nativeView.previousProposers;
    }
    return this._previousProposers;
  }

  get currentProposers(): ValidatorIndex[] {
    if (this._currentProposers === null) {
      this._currentProposers = this.nativeView.currentProposers;
    }
    return this._currentProposers;
  }

  get nextProposers(): ValidatorIndex[] {
    if (this._nextProposers === null) {
      this._nextProposers = this.nativeView.nextProposers;
    }
    return this._nextProposers;
  }

  getBeaconProposer(slot: Slot): ValidatorIndex {
    let cached = this._getBeaconProposer.get(slot);
    if (cached === undefined) {
      cached = this.nativeView.getBeaconProposer(slot);
      this._getBeaconProposer.set(slot, cached);
    }
    return cached;
  }

  getBeaconProposerOrNull(slot: Slot): ValidatorIndex | null {
    if (!this._getBeaconProposerOrNull.has(slot)) {
      this._getBeaconProposerOrNull.set(slot, this.nativeView.getBeaconProposerOrNull(slot));
    }
    // biome-ignore lint/style/noNonNullAssertion: has() check guarantees a value
    return this._getBeaconProposerOrNull.get(slot)!;
  }

  // Validators and balances

  get effectiveBalanceIncrements(): EffectiveBalanceIncrements {
    if (this._effectiveBalanceIncrements === null) {
      this._effectiveBalanceIncrements = this.nativeView.effectiveBalanceIncrements;
    }
    return this._effectiveBalanceIncrements;
  }

  getEffectiveBalanceIncrementsZeroInactive(): EffectiveBalanceIncrements {
    if (this._getEffectiveBalanceIncrementsZeroInactive === null) {
      this._getEffectiveBalanceIncrementsZeroInactive = this.nativeView.getEffectiveBalanceIncrementsZeroInactive();
    }
    return this._getEffectiveBalanceIncrementsZeroInactive;
  }

  getBalance(index: number): number {
    let cached = this._getBalance.get(index);
    if (cached === undefined) {
      cached = this.nativeView.getBalance(index);
      this._getBalance.set(index, cached);
    }
    return cached;
  }

  getValidator(index: ValidatorIndex): phase0.Validator {
    let cached = this._getValidator.get(index);
    if (cached === undefined) {
      cached = this.nativeView.getValidator(index);
      this._getValidator.set(index, cached);
    }
    return cached;
  }

  getValidatorsByStatus(statuses: Set<string>, currentEpoch: Epoch): phase0.Validator[] {
    return this.nativeView.getValidatorsByStatus(statuses, currentEpoch);
  }

  get validatorCount(): number {
    if (this._validatorCount === null) {
      this._validatorCount = this.nativeView.validatorCount;
    }
    return this._validatorCount;
  }

  get activeValidatorCount(): number {
    if (this._activeValidatorCount === null) {
      this._activeValidatorCount = this.nativeView.activeValidatorCount;
    }
    return this._activeValidatorCount;
  }

  getAllValidators(): phase0.Validator[] {
    if (this._getAllValidators === null) {
      this._getAllValidators = this.nativeView.getAllValidators();
    }
    return this._getAllValidators;
  }

  getAllBalances(): number[] {
    if (this._getAllBalances === null) {
      this._getAllBalances = this.nativeView.getAllBalances();
    }
    return this._getAllBalances;
  }

  // API

  get proposerRewards(): RewardCache {
    return this.nativeView.proposerRewards;
  }

  computeBlockRewards(block: BeaconBlock, proposerRewards?: RewardCache): Promise<rewards.BlockRewards> {
    return this.nativeView.computeBlockRewards(block, proposerRewards);
  }

  computeAttestationsRewards(validatorIds?: (ValidatorIndex | string)[]): Promise<rewards.AttestationsRewards> {
    return this.nativeView.computeAttestationsRewards(validatorIds);
  }

  getLatestWeakSubjectivityCheckpointEpoch(): Epoch {
    if (this._getLatestWeakSubjectivityCheckpointEpoch === null) {
      this._getLatestWeakSubjectivityCheckpointEpoch = this.nativeView.getLatestWeakSubjectivityCheckpointEpoch();
    }
    return this._getLatestWeakSubjectivityCheckpointEpoch;
  }

  // Validation

  getVoluntaryExitValidity(
    signedVoluntaryExit: phase0.SignedVoluntaryExit,
    verifySignature: boolean
  ): VoluntaryExitValidity {
    return this.nativeView.getVoluntaryExitValidity(signedVoluntaryExit, verifySignature);
  }

  isValidVoluntaryExit(signedVoluntaryExit: phase0.SignedVoluntaryExit, verifySignature: boolean): boolean {
    return this.nativeView.isValidVoluntaryExit(signedVoluntaryExit, verifySignature);
  }

  // Proofs

  getFinalizedRootProof(): Uint8Array[] {
    if (this._getFinalizedRootProof === null) {
      this._getFinalizedRootProof = this.nativeView.getFinalizedRootProof();
    }
    return this._getFinalizedRootProof;
  }

  getSingleProof(gindex: bigint): Uint8Array[] {
    let cached = this._getSingleProof.get(gindex);
    if (cached === undefined) {
      cached = this.nativeView.getSingleProof(gindex);
      this._getSingleProof.set(gindex, cached);
    }
    return cached;
  }

  createMultiProof(descriptor: Uint8Array): CompactMultiProof {
    return this.nativeView.createMultiProof(descriptor);
  }

  // Fork choice

  computeUnrealizedCheckpoints(): {
    justifiedCheckpoint: phase0.Checkpoint;
    finalizedCheckpoint: phase0.Checkpoint;
  } {
    if (this._computeUnrealizedCheckpoints === null) {
      this._computeUnrealizedCheckpoints = this.nativeView.computeUnrealizedCheckpoints();
    }
    return this._computeUnrealizedCheckpoints;
  }

  computeAnchorCheckpoint(): {checkpoint: phase0.Checkpoint; blockHeader: phase0.BeaconBlockHeader} {
    if (this._computeAnchorCheckpoint === null) {
      this._computeAnchorCheckpoint = this.nativeView.computeAnchorCheckpoint();
    }
    return this._computeAnchorCheckpoint;
  }

  // Backward compatibility

  get clonedCount(): number {
    return this.nativeView.clonedCount;
  }

  get clonedCountWithTransferCache(): number {
    return this.nativeView.clonedCountWithTransferCache;
  }

  get createdWithTransferCache(): boolean {
    if (this._createdWithTransferCache === null) {
      this._createdWithTransferCache = this.nativeView.createdWithTransferCache;
    }
    return this._createdWithTransferCache;
  }

  isStateValidatorsNodesPopulated(): boolean {
    if (this._isStateValidatorsNodesPopulated === null) {
      this._isStateValidatorsNodesPopulated = this.nativeView.isStateValidatorsNodesPopulated();
    }
    return this._isStateValidatorsNodesPopulated;
  }

  // Serialization

  loadOtherState(
    stateBytes: Uint8Array,
    seedValidatorsBytes?: Uint8Array,
    opts?: {preloadValidatorsAndBalances?: boolean}
  ): IBeaconStateView {
    return new NativeBeaconStateView(
      this.nativeView.loadOtherState(stateBytes, seedValidatorsBytes, opts),
      this.config
    );
  }

  toValue(): BeaconState {
    if (this._toValue === null) {
      this._toValue = this.nativeView.toValue();
    }
    return this._toValue;
  }

  serialize(): Uint8Array {
    if (this._serialize === null) {
      this._serialize = this.nativeView.serialize();
    }
    return this._serialize;
  }

  serializedSize(): number {
    if (this._serializedSize === null) {
      this._serializedSize = this.nativeView.serializedSize();
    }
    return this._serializedSize;
  }

  serializeToBytes(output: ByteViews, offset: number): number {
    return this.nativeView.serializeToBytes(output, offset);
  }

  serializeValidators(): Uint8Array {
    if (this._serializeValidators === null) {
      this._serializeValidators = this.nativeView.serializeValidators();
    }
    return this._serializeValidators;
  }

  serializedValidatorsSize(): number {
    if (this._serializedValidatorsSize === null) {
      this._serializedValidatorsSize = this.nativeView.serializedValidatorsSize();
    }
    return this._serializedValidatorsSize;
  }

  serializeValidatorsToBytes(output: ByteViews, offset: number): number {
    return this.nativeView.serializeValidatorsToBytes(output, offset);
  }

  hashTreeRoot(): Uint8Array {
    if (this._hashTreeRoot === null) {
      this._hashTreeRoot = this.nativeView.hashTreeRoot();
    }
    return this._hashTreeRoot;
  }

  // State transition

  stateTransition(
    signedBlock: SignedBeaconBlock | SignedBlindedBeaconBlock,
    options: StateTransitionOpts,
    _modules: StateTransitionModules
  ): IBeaconStateView {
    const blockSlot = signedBlock.message.slot;

    const blockBytes = isBlindedBeaconBlock(signedBlock.message)
      ? this.config
          .getPostBellatrixForkTypes(blockSlot)
          .SignedBlindedBeaconBlock.serialize(signedBlock as SignedBlindedBeaconBlock)
      : this.config.getForkTypes(blockSlot).SignedBeaconBlock.serialize(signedBlock as SignedBeaconBlock);

    return new NativeBeaconStateView(this.nativeView.stateTransition(blockBytes, options), this.config);
  }

  processSlots(
    slot: Slot,
    epochTransitionCacheOpts?: EpochTransitionCacheOpts & {dontTransferCache?: boolean},
    _modules?: StateTransitionModules
  ): IBeaconStateView {
    return new NativeBeaconStateView(this.nativeView.processSlots(slot, epochTransitionCacheOpts), this.config);
  }

  // ─── altair ──────────────────────────────────────────────────────────────

  get previousEpochParticipation(): Uint8Array {
    if (this._previousEpochParticipation === null) {
      this._previousEpochParticipation = this.nativeView.previousEpochParticipation;
    }
    return this._previousEpochParticipation;
  }

  get currentEpochParticipation(): Uint8Array {
    if (this._currentEpochParticipation === null) {
      this._currentEpochParticipation = this.nativeView.currentEpochParticipation;
    }
    return this._currentEpochParticipation;
  }

  getPreviousEpochParticipation(validatorIndex: ValidatorIndex): number {
    return this.previousEpochParticipation[validatorIndex];
  }

  getCurrentEpochParticipation(validatorIndex: ValidatorIndex): number {
    return this.currentEpochParticipation[validatorIndex];
  }

  get currentSyncCommittee(): altair.SyncCommittee {
    if (this._currentSyncCommittee === null) {
      this._currentSyncCommittee = this.nativeView.currentSyncCommittee;
    }
    return this._currentSyncCommittee;
  }

  get nextSyncCommittee(): altair.SyncCommittee {
    if (this._nextSyncCommittee === null) {
      this._nextSyncCommittee = this.nativeView.nextSyncCommittee;
    }
    return this._nextSyncCommittee;
  }

  get currentSyncCommitteeIndexed(): SyncCommitteeCache {
    if (this._currentSyncCommitteeIndexed === null) {
      this._currentSyncCommitteeIndexed = this.nativeView.currentSyncCommitteeIndexed;
    }
    return this._currentSyncCommitteeIndexed;
  }

  get syncProposerReward(): number {
    if (this._syncProposerReward === null) {
      this._syncProposerReward = this.nativeView.syncProposerReward;
    }
    return this._syncProposerReward;
  }

  getIndexedSyncCommitteeAtEpoch(epoch: Epoch): SyncCommitteeCache {
    let cached = this._getIndexedSyncCommitteeAtEpoch.get(epoch);
    if (cached === undefined) {
      cached = this.nativeView.getIndexedSyncCommitteeAtEpoch(epoch);
      this._getIndexedSyncCommitteeAtEpoch.set(epoch, cached);
    }
    return cached;
  }

  getIndexedSyncCommittee(slot: Slot): SyncCommitteeCache {
    let cached = this._getIndexedSyncCommittee.get(slot);
    if (cached === undefined) {
      cached = this.nativeView.getIndexedSyncCommittee(slot);
      this._getIndexedSyncCommittee.set(slot, cached);
    }
    return cached;
  }

  computeSyncCommitteeRewards(
    block: BeaconBlock,
    validatorIds: (ValidatorIndex | string)[]
  ): Promise<rewards.SyncCommitteeRewards> {
    return this.nativeView.computeSyncCommitteeRewards(block, validatorIds);
  }

  getSyncCommitteesWitness(): SyncCommitteeWitness {
    if (this._getSyncCommitteesWitness === null) {
      this._getSyncCommitteesWitness = this.nativeView.getSyncCommitteesWitness();
    }
    return this._getSyncCommitteesWitness;
  }

  // ─── bellatrix ───────────────────────────────────────────────────────────

  get latestExecutionPayloadHeader(): ExecutionPayloadHeader {
    if (this._latestExecutionPayloadHeader === null) {
      this._latestExecutionPayloadHeader = this.nativeView.latestExecutionPayloadHeader;
    }
    return this._latestExecutionPayloadHeader;
  }

  get payloadBlockNumber(): number {
    if (this._payloadBlockNumber === null) {
      this._payloadBlockNumber = this.nativeView.payloadBlockNumber;
    }
    return this._payloadBlockNumber;
  }

  get isExecutionStateType(): boolean {
    if (this._isExecutionStateType === null) {
      this._isExecutionStateType = this.nativeView.isExecutionStateType;
    }
    return this._isExecutionStateType;
  }

  get isMergeTransitionComplete(): boolean {
    if (this._isMergeTransitionComplete === null) {
      this._isMergeTransitionComplete = this.nativeView.isMergeTransitionComplete;
    }
    return this._isMergeTransitionComplete;
  }

  isExecutionEnabled(block: BeaconBlock | BlindedBeaconBlock): boolean {
    return this.nativeView.isExecutionEnabled(block);
  }

  // ─── capella ─────────────────────────────────────────────────────────────

  get historicalSummaries(): capella.HistoricalSummaries {
    if (this._historicalSummaries === null) {
      this._historicalSummaries = this.nativeView.historicalSummaries;
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
    if (this._getExpectedWithdrawals === null) {
      this._getExpectedWithdrawals = this.nativeView.getExpectedWithdrawals();
    }
    return this._getExpectedWithdrawals;
  }

  // ─── electra ─────────────────────────────────────────────────────────────

  get pendingDeposits(): electra.PendingDeposits {
    if (this._pendingDeposits === null) {
      const pendingDepositsBytes = this.nativeView.pendingDeposits;
      this._pendingDeposits = ssz.electra.PendingDeposits.deserialize(pendingDepositsBytes);
    }
    return this._pendingDeposits;
  }

  get pendingDepositsCount(): number {
    if (this._pendingDepositsCount === null) {
      this._pendingDepositsCount = this.nativeView.pendingDepositsCount;
    }
    return this._pendingDepositsCount;
  }

  get pendingPartialWithdrawals(): electra.PendingPartialWithdrawals {
    if (this._pendingPartialWithdrawals === null) {
      const pendingPartialWithdrawalsBytes = this.nativeView.pendingPartialWithdrawals;
      this._pendingPartialWithdrawals =
        ssz.electra.PendingPartialWithdrawals.deserialize(pendingPartialWithdrawalsBytes);
    }
    return this._pendingPartialWithdrawals;
  }

  get pendingPartialWithdrawalsCount(): number {
    if (this._pendingPartialWithdrawalsCount === null) {
      this._pendingPartialWithdrawalsCount = this.nativeView.pendingPartialWithdrawalsCount;
    }
    return this._pendingPartialWithdrawalsCount;
  }

  get pendingConsolidations(): electra.PendingConsolidations {
    if (this._pendingConsolidations === null) {
      const pendingConsolidationsBytes = this.nativeView.pendingConsolidations;
      this._pendingConsolidations = ssz.electra.PendingConsolidations.deserialize(pendingConsolidationsBytes);
    }
    return this._pendingConsolidations;
  }

  get pendingConsolidationsCount(): number {
    if (this._pendingConsolidationsCount === null) {
      this._pendingConsolidationsCount = this.nativeView.pendingConsolidationsCount;
    }
    return this._pendingConsolidationsCount;
  }

  // ─── fulu ────────────────────────────────────────────────────────────────

  get proposerLookahead(): fulu.ProposerLookahead {
    if (this._proposerLookahead === null) {
      this._proposerLookahead = Array.from(this.nativeView.proposerLookahead);
    }
    return this._proposerLookahead;
  }

  // ─── gloas ───────────────────────────────────────────────────────────────

  get latestBlockHash(): Bytes32 {
    throw new Error("NativeBeaconStateView does not support Gloas");
  }

  // executionPayloadAvailability getter is defined near the top of the class.

  get latestExecutionPayloadBid(): ExecutionPayloadBid {
    throw new Error("NativeBeaconStateView does not support Gloas");
  }

  get payloadExpectedWithdrawals(): capella.Withdrawal[] {
    throw new Error("NativeBeaconStateView does not support Gloas");
  }

  getBuilder(_index: BuilderIndex): gloas.Builder {
    throw new Error("NativeBeaconStateView does not support Gloas");
  }

  canBuilderCoverBid(_builderIndex: BuilderIndex, _bidAmount: number): boolean {
    throw new Error("NativeBeaconStateView does not support Gloas");
  }

  getEpochPTCs(_epoch: Epoch): Uint32Array[] {
    throw new Error("NativeBeaconStateView does not support Gloas");
  }

  getIndicesInPayloadTimelinessCommittee(_validatorIndex: ValidatorIndex, _slot: Slot): number[] {
    throw new Error("NativeBeaconStateView does not support Gloas");
  }

  withParentPayloadApplied(_executionRequests: electra.ExecutionRequests): IBeaconStateViewGloas {
    throw new Error("NativeBeaconStateView does not support Gloas");
  }
}
