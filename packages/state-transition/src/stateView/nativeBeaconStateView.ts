import {CompactMultiProof} from "@chainsafe/persistent-merkle-tree";
import {BitArray, ByteViews} from "@chainsafe/ssz";
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
import {PreVerifyBuilderDepositsResult} from "../util/preVerifyBuilderDeposits.js";
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
  // gloas
  private _executionPayloadAvailability: BitArray | null = null;
  private _latestBlockHash: Bytes32 | null = null;
  private _latestExecutionPayloadBid: ExecutionPayloadBid | null = null;
  private _payloadExpectedWithdrawals: capella.Withdrawal[] | null = null;

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
  private readonly _getValidator = new Map<ValidatorIndex, phase0.Validator>();
  private readonly _getBalance = new Map<number, number>();
  private readonly _getIndexedSyncCommitteeAtEpoch = new Map<Epoch, SyncCommitteeCache>();
  private readonly _getIndexedSyncCommittee = new Map<Slot, SyncCommitteeCache>();
  private readonly _getSingleProof = new Map<bigint, Uint8Array[]>();
  private readonly _getEpochPTCs = new Map<Epoch, Uint32Array[]>();
  private readonly _getBuilder = new Map<BuilderIndex, gloas.Builder>();

  // No-arg method caches
  private _getPreviousShuffling: EpochShuffling | null = null;
  private _getCurrentShuffling: EpochShuffling | null = null;
  private _getNextShuffling: EpochShuffling | null = null;
  private _getEffectiveBalanceIncrementsZeroInactive: EffectiveBalanceIncrements | null = null;
  private _getAllValidators: phase0.Validator[] | null = null;
  private _getBuildersLength: number | null = null;
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

  constructor(readonly binding: IBeaconStateViewNative) {}

  // Binding returns pojo object {uint8Array: Uint8Array; bitLen: number}
  // this class wrap it with BitArray to conform to the api
  get executionPayloadAvailability(): BitArray {
    if (this._executionPayloadAvailability === null) {
      const pojo = this.binding.executionPayloadAvailability;
      this._executionPayloadAvailability = new BitArray(pojo.uint8Array, pojo.bitLen);
    }

    return this._executionPayloadAvailability;
  }

  // ─── phase0 ──────────────────────────────────────────────────────────────

  get forkName(): ForkName {
    if (this._forkName === null) {
      this._forkName = this.binding.forkName;
    }
    return this._forkName;
  }

  get slot(): Slot {
    if (this._slot === null) {
      this._slot = this.binding.slot;
    }
    return this._slot;
  }

  get fork(): Fork {
    if (this._fork === null) {
      this._fork = this.binding.fork;
    }
    return this._fork;
  }

  get epoch(): Epoch {
    if (this._epoch === null) {
      this._epoch = this.binding.epoch;
    }
    return this._epoch;
  }

  get genesisTime(): number {
    if (this._genesisTime === null) {
      this._genesisTime = this.binding.genesisTime;
    }
    return this._genesisTime;
  }

  get genesisValidatorsRoot(): Root {
    if (this._genesisValidatorsRoot === null) {
      this._genesisValidatorsRoot = this.binding.genesisValidatorsRoot;
    }
    return this._genesisValidatorsRoot;
  }

  get eth1Data(): phase0.Eth1Data {
    if (this._eth1Data === null) {
      this._eth1Data = this.binding.eth1Data;
    }
    return this._eth1Data;
  }

  get latestBlockHeader(): phase0.BeaconBlockHeader {
    if (this._latestBlockHeader === null) {
      this._latestBlockHeader = this.binding.latestBlockHeader;
    }
    return this._latestBlockHeader;
  }

  get previousJustifiedCheckpoint(): Checkpoint {
    if (this._previousJustifiedCheckpoint === null) {
      this._previousJustifiedCheckpoint = this.binding.previousJustifiedCheckpoint;
    }
    return this._previousJustifiedCheckpoint;
  }

  get currentJustifiedCheckpoint(): Checkpoint {
    if (this._currentJustifiedCheckpoint === null) {
      this._currentJustifiedCheckpoint = this.binding.currentJustifiedCheckpoint;
    }
    return this._currentJustifiedCheckpoint;
  }

  get finalizedCheckpoint(): Checkpoint {
    if (this._finalizedCheckpoint === null) {
      this._finalizedCheckpoint = this.binding.finalizedCheckpoint;
    }
    return this._finalizedCheckpoint;
  }

  getBlockRootAtSlot(slot: Slot): Root {
    let cached = this._getBlockRootAtSlot.get(slot);
    if (cached === undefined) {
      cached = this.binding.getBlockRootAtSlot(slot);
      this._getBlockRootAtSlot.set(slot, cached);
    }
    return cached;
  }

  getBlockRootAtEpoch(epoch: Epoch): Root {
    let cached = this._getBlockRootAtEpoch.get(epoch);
    if (cached === undefined) {
      cached = this.binding.getBlockRootAtEpoch(epoch);
      this._getBlockRootAtEpoch.set(epoch, cached);
    }
    return cached;
  }

  getStateRootAtSlot(slot: Slot): Root {
    let cached = this._getStateRootAtSlot.get(slot);
    if (cached === undefined) {
      cached = this.binding.getStateRootAtSlot(slot);
      this._getStateRootAtSlot.set(slot, cached);
    }
    return cached;
  }

  getRandaoMix(epoch: Epoch): Bytes32 {
    let cached = this._getRandaoMix.get(epoch);
    if (cached === undefined) {
      cached = this.binding.getRandaoMix(epoch);
      this._getRandaoMix.set(epoch, cached);
    }
    return cached;
  }

  // Shuffling and committees

  getShufflingAtEpoch(epoch: Epoch): EpochShuffling {
    let cached = this._getShufflingAtEpoch.get(epoch);
    if (cached === undefined) {
      cached = this.binding.getShufflingAtEpoch(epoch);
      this._getShufflingAtEpoch.set(epoch, cached);
    }
    return cached;
  }

  getBeaconCommittee(slot: Slot, index: CommitteeIndex): Uint32Array {
    const key = `${slot}:${index}`;
    let cached = this._getBeaconCommittee.get(key);
    if (cached === undefined) {
      cached = this.binding.getBeaconCommittee(slot, index);
      this._getBeaconCommittee.set(key, cached);
    }
    return cached;
  }

  getBeaconCommitteeCountPerSlot(epoch: Epoch): number {
    let cached = this._getBeaconCommitteeCountPerSlot.get(epoch);
    if (cached === undefined) {
      cached = this.binding.getBeaconCommitteeCountPerSlot(epoch);
      this._getBeaconCommitteeCountPerSlot.set(epoch, cached);
    }
    return cached;
  }

  get previousDecisionRoot(): RootHex {
    if (this._previousDecisionRoot === null) {
      this._previousDecisionRoot = this.binding.previousDecisionRoot;
    }
    return this._previousDecisionRoot;
  }

  get currentDecisionRoot(): RootHex {
    if (this._currentDecisionRoot === null) {
      this._currentDecisionRoot = this.binding.currentDecisionRoot;
    }
    return this._currentDecisionRoot;
  }

  get nextDecisionRoot(): RootHex {
    if (this._nextDecisionRoot === null) {
      this._nextDecisionRoot = this.binding.nextDecisionRoot;
    }
    return this._nextDecisionRoot;
  }

  getShufflingDecisionRoot(epoch: Epoch): RootHex {
    let cached = this._getShufflingDecisionRoot.get(epoch);
    if (cached === undefined) {
      cached = this.binding.getShufflingDecisionRoot(epoch);
      this._getShufflingDecisionRoot.set(epoch, cached);
    }
    return cached;
  }

  getPreviousShuffling(): EpochShuffling {
    if (this._getPreviousShuffling === null) {
      this._getPreviousShuffling = this.binding.getPreviousShuffling();
    }
    return this._getPreviousShuffling;
  }

  getCurrentShuffling(): EpochShuffling {
    if (this._getCurrentShuffling === null) {
      this._getCurrentShuffling = this.binding.getCurrentShuffling();
    }
    return this._getCurrentShuffling;
  }

  getNextShuffling(): EpochShuffling {
    if (this._getNextShuffling === null) {
      this._getNextShuffling = this.binding.getNextShuffling();
    }
    return this._getNextShuffling;
  }

  // Proposer shuffling

  get previousProposers(): ValidatorIndex[] | null {
    if (this._previousProposers === undefined) {
      this._previousProposers = this.binding.previousProposers;
    }
    return this._previousProposers;
  }

  get currentProposers(): ValidatorIndex[] {
    if (this._currentProposers === null) {
      this._currentProposers = this.binding.currentProposers;
    }
    return this._currentProposers;
  }

  get nextProposers(): ValidatorIndex[] {
    if (this._nextProposers === null) {
      this._nextProposers = this.binding.nextProposers;
    }
    return this._nextProposers;
  }

  getBeaconProposer(slot: Slot): ValidatorIndex {
    let cached = this._getBeaconProposer.get(slot);
    if (cached === undefined) {
      cached = this.binding.getBeaconProposer(slot);
      this._getBeaconProposer.set(slot, cached);
    }
    return cached;
  }

  // Validators and balances

  get effectiveBalanceIncrements(): EffectiveBalanceIncrements {
    if (this._effectiveBalanceIncrements === null) {
      this._effectiveBalanceIncrements = this.binding.effectiveBalanceIncrements;
    }
    return this._effectiveBalanceIncrements;
  }

  getEffectiveBalanceIncrementsZeroInactive(): EffectiveBalanceIncrements {
    if (this._getEffectiveBalanceIncrementsZeroInactive === null) {
      this._getEffectiveBalanceIncrementsZeroInactive = this.binding.getEffectiveBalanceIncrementsZeroInactive();
    }
    return this._getEffectiveBalanceIncrementsZeroInactive;
  }

  getBalance(index: number): number {
    let cached = this._getBalance.get(index);
    if (cached === undefined) {
      cached = this.binding.getBalance(index);
      this._getBalance.set(index, cached);
    }
    return cached;
  }

  getValidator(index: ValidatorIndex): phase0.Validator {
    let cached = this._getValidator.get(index);
    if (cached === undefined) {
      cached = this.binding.getValidator(index);
      this._getValidator.set(index, cached);
    }
    return cached;
  }

  getValidatorsByStatus(statuses: Set<string>, currentEpoch: Epoch): phase0.Validator[] {
    return this.binding.getValidatorsByStatus(statuses, currentEpoch);
  }

  get validatorCount(): number {
    if (this._validatorCount === null) {
      this._validatorCount = this.binding.validatorCount;
    }
    return this._validatorCount;
  }

  get activeValidatorCount(): number {
    if (this._activeValidatorCount === null) {
      this._activeValidatorCount = this.binding.activeValidatorCount;
    }
    return this._activeValidatorCount;
  }

  getAllValidators(): phase0.Validator[] {
    if (this._getAllValidators === null) {
      this._getAllValidators = this.binding.getAllValidators();
    }
    return this._getAllValidators;
  }

  getAllBalances(): number[] {
    if (this._getAllBalances === null) {
      this._getAllBalances = this.binding.getAllBalances();
    }
    return this._getAllBalances;
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
    if (this._getLatestWeakSubjectivityCheckpointEpoch === null) {
      this._getLatestWeakSubjectivityCheckpointEpoch = this.binding.getLatestWeakSubjectivityCheckpointEpoch();
    }
    return this._getLatestWeakSubjectivityCheckpointEpoch;
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
    if (this._getFinalizedRootProof === null) {
      this._getFinalizedRootProof = this.binding.getFinalizedRootProof();
    }
    return this._getFinalizedRootProof;
  }

  getSingleProof(gindex: bigint): Uint8Array[] {
    let cached = this._getSingleProof.get(gindex);
    if (cached === undefined) {
      cached = this.binding.getSingleProof(gindex);
      this._getSingleProof.set(gindex, cached);
    }
    return cached;
  }

  createMultiProof(descriptor: Uint8Array): CompactMultiProof {
    return this.binding.createMultiProof(descriptor);
  }

  // Fork choice

  computeUnrealizedCheckpoints(): {
    justifiedCheckpoint: phase0.Checkpoint;
    finalizedCheckpoint: phase0.Checkpoint;
  } {
    if (this._computeUnrealizedCheckpoints === null) {
      this._computeUnrealizedCheckpoints = this.binding.computeUnrealizedCheckpoints();
    }
    return this._computeUnrealizedCheckpoints;
  }

  computeAnchorCheckpoint(): {checkpoint: phase0.Checkpoint; blockHeader: phase0.BeaconBlockHeader} {
    if (this._computeAnchorCheckpoint === null) {
      this._computeAnchorCheckpoint = this.binding.computeAnchorCheckpoint();
    }
    return this._computeAnchorCheckpoint;
  }

  // Backward compatibility

  get clonedCount(): number {
    return this.binding.clonedCount;
  }

  get clonedCountWithTransferCache(): number {
    return this.binding.clonedCountWithTransferCache;
  }

  get createdWithTransferCache(): boolean {
    if (this._createdWithTransferCache === null) {
      this._createdWithTransferCache = this.binding.createdWithTransferCache;
    }
    return this._createdWithTransferCache;
  }

  isStateValidatorsNodesPopulated(): boolean {
    if (this._isStateValidatorsNodesPopulated === null) {
      this._isStateValidatorsNodesPopulated = this.binding.isStateValidatorsNodesPopulated();
    }
    return this._isStateValidatorsNodesPopulated;
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
    if (this._toValue === null) {
      this._toValue = this.binding.toValue();
    }
    return this._toValue;
  }

  serialize(): Uint8Array {
    if (this._serialize === null) {
      this._serialize = this.binding.serialize();
    }
    return this._serialize;
  }

  serializedSize(): number {
    if (this._serializedSize === null) {
      this._serializedSize = this.binding.serializedSize();
    }
    return this._serializedSize;
  }

  serializeToBytes(output: ByteViews, offset: number): number {
    return this.binding.serializeToBytes(output, offset);
  }

  serializeValidators(): Uint8Array {
    if (this._serializeValidators === null) {
      this._serializeValidators = this.binding.serializeValidators();
    }
    return this._serializeValidators;
  }

  serializedValidatorsSize(): number {
    if (this._serializedValidatorsSize === null) {
      this._serializedValidatorsSize = this.binding.serializedValidatorsSize();
    }
    return this._serializedValidatorsSize;
  }

  serializeValidatorsToBytes(output: ByteViews, offset: number): number {
    return this.binding.serializeValidatorsToBytes(output, offset);
  }

  hashTreeRoot(): Uint8Array {
    if (this._hashTreeRoot === null) {
      this._hashTreeRoot = this.binding.hashTreeRoot();
    }
    return this._hashTreeRoot;
  }

  // State transition

  stateTransition(
    signedBlockBytes: Uint8Array,
    isBlinded: boolean,
    options: StateTransitionOpts,
    _modules: StateTransitionModules
  ): IBeaconStateView {
    return new NativeBeaconStateView(this.binding.stateTransition(signedBlockBytes, isBlinded, options));
  }

  processSlots(
    slot: Slot,
    epochTransitionCacheOpts?: EpochTransitionCacheOpts & {dontTransferCache?: boolean},
    _modules?: StateTransitionModules
  ): IBeaconStateView {
    return new NativeBeaconStateView(this.binding.processSlots(slot, epochTransitionCacheOpts));
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
    return this.previousEpochParticipation[validatorIndex];
  }

  getCurrentEpochParticipation(validatorIndex: ValidatorIndex): number {
    return this.currentEpochParticipation[validatorIndex];
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
    if (this._currentSyncCommitteeIndexed === null) {
      this._currentSyncCommitteeIndexed = this.binding.currentSyncCommitteeIndexed;
    }
    return this._currentSyncCommitteeIndexed;
  }

  get syncProposerReward(): number {
    if (this._syncProposerReward === null) {
      this._syncProposerReward = this.binding.syncProposerReward;
    }
    return this._syncProposerReward;
  }

  getIndexedSyncCommitteeAtEpoch(epoch: Epoch): SyncCommitteeCache {
    let cached = this._getIndexedSyncCommitteeAtEpoch.get(epoch);
    if (cached === undefined) {
      cached = this.binding.getIndexedSyncCommitteeAtEpoch(epoch);
      this._getIndexedSyncCommitteeAtEpoch.set(epoch, cached);
    }
    return cached;
  }

  getIndexedSyncCommittee(slot: Slot): SyncCommitteeCache {
    let cached = this._getIndexedSyncCommittee.get(slot);
    if (cached === undefined) {
      cached = this.binding.getIndexedSyncCommittee(slot);
      this._getIndexedSyncCommittee.set(slot, cached);
    }
    return cached;
  }

  computeSyncCommitteeRewards(
    block: BeaconBlock,
    validatorIds: (ValidatorIndex | string)[]
  ): Promise<rewards.SyncCommitteeRewards> {
    return this.binding.computeSyncCommitteeRewards(block, validatorIds);
  }

  getSyncCommitteesWitness(): SyncCommitteeWitness {
    if (this._getSyncCommitteesWitness === null) {
      this._getSyncCommitteesWitness = this.binding.getSyncCommitteesWitness();
    }
    return this._getSyncCommitteesWitness;
  }

  // ─── bellatrix ───────────────────────────────────────────────────────────

  get latestExecutionPayloadHeader(): ExecutionPayloadHeader {
    if (this._latestExecutionPayloadHeader === null) {
      this._latestExecutionPayloadHeader = this.binding.latestExecutionPayloadHeader;
    }
    return this._latestExecutionPayloadHeader;
  }

  get payloadBlockNumber(): number {
    if (this._payloadBlockNumber === null) {
      this._payloadBlockNumber = this.binding.payloadBlockNumber;
    }
    return this._payloadBlockNumber;
  }

  get isExecutionStateType(): boolean {
    if (this._isExecutionStateType === null) {
      this._isExecutionStateType = this.binding.isExecutionStateType;
    }
    return this._isExecutionStateType;
  }

  get isMergeTransitionComplete(): boolean {
    if (this._isMergeTransitionComplete === null) {
      this._isMergeTransitionComplete = this.binding.isMergeTransitionComplete;
    }
    return this._isMergeTransitionComplete;
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
    if (this._getExpectedWithdrawals === null) {
      this._getExpectedWithdrawals = this.binding.getExpectedWithdrawals();
    }
    return this._getExpectedWithdrawals;
  }

  // ─── electra ─────────────────────────────────────────────────────────────

  get pendingDeposits(): electra.PendingDeposits {
    if (this._pendingDeposits === null) {
      this._pendingDeposits = this.binding.pendingDeposits;
    }
    return this._pendingDeposits;
  }

  get pendingDepositsCount(): number {
    if (this._pendingDepositsCount === null) {
      this._pendingDepositsCount = this.binding.pendingDepositsCount;
    }
    return this._pendingDepositsCount;
  }

  get pendingPartialWithdrawals(): electra.PendingPartialWithdrawals {
    if (this._pendingPartialWithdrawals === null) {
      this._pendingPartialWithdrawals = this.binding.pendingPartialWithdrawals;
    }
    return this._pendingPartialWithdrawals;
  }

  get pendingPartialWithdrawalsCount(): number {
    if (this._pendingPartialWithdrawalsCount === null) {
      this._pendingPartialWithdrawalsCount = this.binding.pendingPartialWithdrawalsCount;
    }
    return this._pendingPartialWithdrawalsCount;
  }

  get pendingConsolidations(): electra.PendingConsolidations {
    if (this._pendingConsolidations === null) {
      this._pendingConsolidations = this.binding.pendingConsolidations;
    }
    return this._pendingConsolidations;
  }

  get pendingConsolidationsCount(): number {
    if (this._pendingConsolidationsCount === null) {
      this._pendingConsolidationsCount = this.binding.pendingConsolidationsCount;
    }
    return this._pendingConsolidationsCount;
  }

  // ─── fulu ────────────────────────────────────────────────────────────────

  get proposerLookahead(): fulu.ProposerLookahead {
    if (this._proposerLookahead === null) {
      this._proposerLookahead = this.binding.proposerLookahead;
    }
    return this._proposerLookahead;
  }

  preVerifyBuilderDepositsPreGloas(maxBuilderDeposits: number, maxDurationMs: number): PreVerifyBuilderDepositsResult {
    return this.binding.preVerifyBuilderDepositsPreGloas(maxBuilderDeposits, maxDurationMs);
  }

  clearPreGloasBuilderDepositCache(): void {
    this.binding.clearPreGloasBuilderDepositCache();
  }

  // ─── gloas ───────────────────────────────────────────────────────────────

  get latestBlockHash(): Bytes32 {
    if (this._latestBlockHash === null) {
      this._latestBlockHash = this.binding.latestBlockHash;
    }
    return this._latestBlockHash;
  }

  // executionPayloadAvailability getter is defined near the top of the class.

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
    let cached = this._getBuilder.get(index);
    if (cached === undefined) {
      cached = this.binding.getBuilder(index);
      this._getBuilder.set(index, cached);
    }
    return cached;
  }

  getBuildersLength(): number {
    if (this._getBuildersLength === null) {
      this._getBuildersLength = this.binding.getBuildersLength();
    }
    return this._getBuildersLength;
  }

  canBuilderCoverBid(builderIndex: BuilderIndex, bidAmount: number): boolean {
    return this.binding.canBuilderCoverBid(builderIndex, bidAmount);
  }

  getEpochPTCs(epoch: Epoch): Uint32Array[] {
    let cached = this._getEpochPTCs.get(epoch);
    if (cached === undefined) {
      cached = this.binding.getEpochPTCs(epoch);
      this._getEpochPTCs.set(epoch, cached);
    }
    return cached;
  }

  getIndicesInPayloadTimelinessCommittee(validatorIndex: ValidatorIndex, slot: Slot): number[] {
    return this.binding.getIndicesInPayloadTimelinessCommittee(validatorIndex, slot);
  }

  withParentPayloadApplied(executionRequests: gloas.ExecutionRequests): IBeaconStateViewGloas {
    const view = new NativeBeaconStateView(this.binding.withParentPayloadApplied(executionRequests));
    if (!isStatePostGloas(view)) {
      throw new Error("Expected gloas state from withParentPayloadApplied");
    }
    return view;
  }
}
