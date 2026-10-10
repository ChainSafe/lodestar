import {CompactMultiProof} from "@chainsafe/persistent-merkle-tree";
import {BitArray, ByteViews} from "@chainsafe/ssz";
import type {BeaconConfig} from "@lodestar/config";
import {ForkName, ForkSeq} from "@lodestar/params";
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
import {RewardCache} from "../cache/rewardCache.js";
import {SyncCommitteeCache} from "../cache/syncCommitteeCache.js";
import {EMPTY_SIGNATURE} from "../constants/constants.js";
import {SyncCommitteeWitness} from "../lightClient/types.js";
import {StateTransitionModules, StateTransitionOpts} from "../stateTransition.js";
import {EpochShuffling} from "../util/epochShuffling.js";
import {PreVerifyBuilderDepositsResult} from "../util/preVerifyBuilderDeposits.js";
import {getStateSlotFromBytes} from "../util/sszBytes.js";
import {computeNewStateRootStateTransitionOpts, getComputeNewStateRootResult} from "./computeNewStateRoot.js";
import {
  BlockSTFInput,
  ComputeNewStateRootResult,
  IBeaconStateView,
  IBeaconStateViewGloas,
  IBeaconStateViewLatestFork,
  IBeaconStateViewNative,
  isStatePostGloas,
} from "./interface.js";

export function assertNativeForkSupported(config: BeaconConfig, slot: Slot): void {
  if (config.getForkSeq(slot) > ForkSeq.gloas) {
    throw Error(`Native state transition does not support ${config.getForkName(slot)}`);
  }
}

/**
 * Wraps a native binding (the auto-generated JS interface produced by a `.node`
 * file) and exposes it as a fully-conformant `IBeaconStateViewLatestFork`.
 *
 * The binding is typed `IBeaconStateViewNative`. This type models FFI-specific
 * inputs and outputs, such as serialized blocks and typed arrays. The wrapper
 * converts those values to the forms used by `IBeaconStateViewLatestFork`.
 *
 * Every getter that returns a value stable for the view's lifetime is cached so
 * the binding is hit at most once per field per view. Only mutable counters
 * (`proposerRewards`, `clonedCount`, `clonedCountWithTransferCache`) stay
 * pass-through. Methods with arguments are pass-through too — caching them
 * would need a per-arg map and isn't worth it without a hot-path signal.
 */
export class NativeBeaconStateView implements IBeaconStateViewLatestFork {
  // phase0
  private cachedForkName: ForkName | null = null;
  private cachedForkSeq: ForkSeq | null = null;
  private cachedSlot: Slot | null = null;
  private cachedFork: Fork | null = null;
  private cachedEpoch: Epoch | null = null;
  private cachedGenesisTime: number | null = null;
  private cachedGenesisValidatorsRoot: Root | null = null;
  private cachedEth1Data: phase0.Eth1Data | null = null;
  private cachedLatestBlockHeader: phase0.BeaconBlockHeader | null = null;
  private cachedPreviousJustifiedCheckpoint: Checkpoint | null = null;
  private cachedCurrentJustifiedCheckpoint: Checkpoint | null = null;
  private cachedFinalizedCheckpoint: Checkpoint | null = null;
  // shuffling / decision roots / proposers
  private cachedPreviousDecisionRoot: RootHex | null = null;
  private cachedCurrentDecisionRoot: RootHex | null = null;
  private cachedNextDecisionRoot: RootHex | null = null;
  // previousProposers can be null, so use undefined as the "not loaded" sentinel
  private cachedPreviousProposers: ValidatorIndex[] | null | undefined = undefined;
  private cachedCurrentProposers: ValidatorIndex[] | null = null;
  private cachedNextProposers: ValidatorIndex[] | null = null;
  // validators / balances
  private cachedEffectiveBalanceIncrements: EffectiveBalanceIncrements | null = null;
  private cachedValidatorCount: number | null = null;
  private cachedActiveValidatorCount: number | null = null;
  // backward compat
  private cachedCreatedWithTransferCache: boolean | null = null;
  // altair
  private cachedCurrentSyncCommittee: SyncCommittee | null = null;
  private cachedNextSyncCommittee: SyncCommittee | null = null;
  private cachedPreviousEpochParticipation: Uint8Array | null = null;
  private cachedCurrentEpochParticipation: Uint8Array | null = null;
  private cachedCurrentSyncCommitteeIndexed: SyncCommitteeCache | null = null;
  private cachedSyncProposerReward: number | null = null;
  // bellatrix
  private cachedLatestExecutionPayloadHeader: ExecutionPayloadHeader | null = null;
  private cachedPayloadBlockNumber: number | null = null;
  private cachedIsExecutionStateType: boolean | null = null;
  private cachedIsMergeTransitionComplete: boolean | null = null;
  // capella
  private cachedHistoricalSummaries: capella.HistoricalSummaries | null = null;
  // electra
  private cachedPendingPartialWithdrawals: electra.PendingPartialWithdrawals | null = null;
  private cachedPendingConsolidations: electra.PendingConsolidations | null = null;
  private cachedPendingDeposits: electra.PendingDeposits | null = null;
  private cachedPendingDepositsCount: number | null = null;
  private cachedPendingPartialWithdrawalsCount: number | null = null;
  private cachedPendingConsolidationsCount: number | null = null;
  // fulu
  private cachedProposerLookahead: fulu.ProposerLookahead | null = null;
  // gloas
  private cachedLatestBlockHash: Bytes32 | null = null;
  private cachedExecutionPayloadAvailability: BitArray | null = null;
  private cachedLatestExecutionPayloadBid: ExecutionPayloadBid | null = null;
  private cachedPayloadExpectedWithdrawals: capella.Withdrawal[] | null = null;
  private cachedBuilderPendingPayments: gloas.BuilderPendingPayments | null = null;
  private cachedBuilderPendingWithdrawals: gloas.BuilderPendingWithdrawals | null = null;
  private cachedBuildersLength: number | null = null;
  // Per-argument caches for argument-taking methods. The binding is treated as
  // immutable for the view's lifetime, so a given argument always yields the
  // same result. Maps grow only with touched arguments — typical call patterns
  // (e.g. a handful of slots per attestation pool scan) keep them tiny.
  private readonly cachedBlockRootAtSlot = new Map<Slot, Root>();
  private readonly cachedBlockRootAtEpoch = new Map<Epoch, Root>();
  private readonly cachedStateRootAtSlot = new Map<Slot, Root>();
  private readonly cachedRandaoMix = new Map<Epoch, Bytes32>();
  private readonly cachedShufflingAtEpoch = new Map<Epoch, EpochShuffling>();
  private readonly cachedBeaconCommittee = new Map<string, Uint32Array>();
  private readonly cachedBeaconCommitteeCountPerSlot = new Map<Epoch, number>();
  private readonly cachedShufflingDecisionRoot = new Map<Epoch, RootHex>();
  private readonly cachedBeaconProposer = new Map<Slot, ValidatorIndex>();
  private readonly cachedValidator = new Map<ValidatorIndex, phase0.Validator>();
  private readonly cachedBalance = new Map<number, number>();
  private readonly cachedIndexedSyncCommitteeAtEpoch = new Map<Epoch, SyncCommitteeCache>();
  private readonly cachedIndexedSyncCommittee = new Map<Slot, SyncCommitteeCache>();
  private readonly cachedSingleProof = new Map<bigint, Uint8Array[]>();

  // No-arg method caches
  private cachedPreviousShuffling: EpochShuffling | null = null;
  private cachedCurrentShuffling: EpochShuffling | null = null;
  private cachedNextShuffling: EpochShuffling | null = null;
  private cachedEffectiveBalanceIncrementsZeroInactive: EffectiveBalanceIncrements | null = null;
  private cachedAllValidators: phase0.Validator[] | null = null;
  private cachedAllBalances: number[] | null = null;
  private cachedLatestWeakSubjectivityCheckpointEpoch: Epoch | null = null;
  private cachedFinalizedRootProof: Uint8Array[] | null = null;
  private cachedUnrealizedCheckpoints: {
    justifiedCheckpoint: phase0.Checkpoint;
    finalizedCheckpoint: phase0.Checkpoint;
  } | null = null;
  private cachedAnchorCheckpoint: {checkpoint: phase0.Checkpoint; blockHeader: phase0.BeaconBlockHeader} | null = null;
  private cachedIsStateValidatorsNodesPopulated: boolean | null = null;
  private cachedValue: BeaconState | null = null;
  private cachedSerialized: Uint8Array | null = null;
  private cachedSerializedSize: number | null = null;
  private cachedSerializedValidators: Uint8Array | null = null;
  private cachedSerializedValidatorsSize: number | null = null;
  private cachedHashTreeRoot: Uint8Array | null = null;
  private cachedSyncCommitteesWitness: SyncCommitteeWitness | null = null;
  private cachedExpectedWithdrawals: {
    expectedWithdrawals: capella.Withdrawal[];
    processedBuilderWithdrawalsCount: number;
    processedPartialWithdrawalsCount: number;
    processedBuildersSweepCount: number;
    processedValidatorSweepCount: number;
  } | null = null;

  constructor(
    private readonly config: BeaconConfig,
    readonly binding: IBeaconStateViewNative
  ) {}

  release(): void {
    this.binding.release();
  }

  get executionPayloadAvailability(): BitArray {
    if (this.cachedExecutionPayloadAvailability === null) {
      const {uint8Array, bitLen} = this.binding.executionPayloadAvailability;
      this.cachedExecutionPayloadAvailability = new BitArray(uint8Array, bitLen);
    }
    return this.cachedExecutionPayloadAvailability;
  }

  // ─── phase0 ──────────────────────────────────────────────────────────────

  get forkName(): ForkName {
    if (this.cachedForkName === null) {
      this.cachedForkName = this.binding.forkName;
    }
    return this.cachedForkName;
  }

  get forkSeq(): ForkSeq {
    if (this.cachedForkSeq === null) {
      this.cachedForkSeq = this.binding.forkSeq;
    }
    return this.cachedForkSeq;
  }

  get slot(): Slot {
    if (this.cachedSlot === null) {
      this.cachedSlot = this.binding.slot;
    }
    return this.cachedSlot;
  }

  get fork(): Fork {
    if (this.cachedFork === null) {
      this.cachedFork = this.binding.fork;
    }
    return this.cachedFork;
  }

  get epoch(): Epoch {
    if (this.cachedEpoch === null) {
      this.cachedEpoch = this.binding.epoch;
    }
    return this.cachedEpoch;
  }

  get genesisTime(): number {
    if (this.cachedGenesisTime === null) {
      this.cachedGenesisTime = this.binding.genesisTime;
    }
    return this.cachedGenesisTime;
  }

  get genesisValidatorsRoot(): Root {
    if (this.cachedGenesisValidatorsRoot === null) {
      this.cachedGenesisValidatorsRoot = this.binding.genesisValidatorsRoot;
    }
    return this.cachedGenesisValidatorsRoot;
  }

  get eth1Data(): phase0.Eth1Data {
    if (this.cachedEth1Data === null) {
      this.cachedEth1Data = this.binding.eth1Data;
    }
    return this.cachedEth1Data;
  }

  get latestBlockHeader(): phase0.BeaconBlockHeader {
    if (this.cachedLatestBlockHeader === null) {
      this.cachedLatestBlockHeader = this.binding.latestBlockHeader;
    }
    return this.cachedLatestBlockHeader;
  }

  get previousJustifiedCheckpoint(): Checkpoint {
    if (this.cachedPreviousJustifiedCheckpoint === null) {
      this.cachedPreviousJustifiedCheckpoint = this.binding.previousJustifiedCheckpoint;
    }
    return this.cachedPreviousJustifiedCheckpoint;
  }

  get currentJustifiedCheckpoint(): Checkpoint {
    if (this.cachedCurrentJustifiedCheckpoint === null) {
      this.cachedCurrentJustifiedCheckpoint = this.binding.currentJustifiedCheckpoint;
    }
    return this.cachedCurrentJustifiedCheckpoint;
  }

  get finalizedCheckpoint(): Checkpoint {
    if (this.cachedFinalizedCheckpoint === null) {
      this.cachedFinalizedCheckpoint = this.binding.finalizedCheckpoint;
    }
    return this.cachedFinalizedCheckpoint;
  }

  getBlockRootAtSlot(slot: Slot): Root {
    let cached = this.cachedBlockRootAtSlot.get(slot);
    if (cached === undefined) {
      cached = this.binding.getBlockRootAtSlot(slot);
      this.cachedBlockRootAtSlot.set(slot, cached);
    }
    return cached;
  }

  getBlockRootAtEpoch(epoch: Epoch): Root {
    let cached = this.cachedBlockRootAtEpoch.get(epoch);
    if (cached === undefined) {
      cached = this.binding.getBlockRootAtEpoch(epoch);
      this.cachedBlockRootAtEpoch.set(epoch, cached);
    }
    return cached;
  }

  getStateRootAtSlot(slot: Slot): Root {
    let cached = this.cachedStateRootAtSlot.get(slot);
    if (cached === undefined) {
      cached = this.binding.getStateRootAtSlot(slot);
      this.cachedStateRootAtSlot.set(slot, cached);
    }
    return cached;
  }

  getRandaoMix(epoch: Epoch): Bytes32 {
    let cached = this.cachedRandaoMix.get(epoch);
    if (cached === undefined) {
      cached = this.binding.getRandaoMix(epoch);
      this.cachedRandaoMix.set(epoch, cached);
    }
    return cached;
  }

  // Shuffling and committees

  getShufflingAtEpoch(epoch: Epoch): EpochShuffling {
    let cached = this.cachedShufflingAtEpoch.get(epoch);
    if (cached === undefined) {
      cached = this.binding.getShufflingAtEpoch(epoch);
      this.cachedShufflingAtEpoch.set(epoch, cached);
    }
    return cached;
  }

  getBeaconCommittee(slot: Slot, index: CommitteeIndex): Uint32Array {
    const key = `${slot}:${index}`;
    let cached = this.cachedBeaconCommittee.get(key);
    if (cached === undefined) {
      cached = this.binding.getBeaconCommittee(slot, index);
      this.cachedBeaconCommittee.set(key, cached);
    }
    return cached;
  }

  getBeaconCommitteeCountPerSlot(epoch: Epoch): number {
    let cached = this.cachedBeaconCommitteeCountPerSlot.get(epoch);
    if (cached === undefined) {
      cached = this.binding.getBeaconCommitteeCountPerSlot(epoch);
      this.cachedBeaconCommitteeCountPerSlot.set(epoch, cached);
    }
    return cached;
  }

  get previousDecisionRoot(): RootHex {
    if (this.cachedPreviousDecisionRoot === null) {
      this.cachedPreviousDecisionRoot = this.binding.previousDecisionRoot;
    }
    return this.cachedPreviousDecisionRoot;
  }

  get currentDecisionRoot(): RootHex {
    if (this.cachedCurrentDecisionRoot === null) {
      this.cachedCurrentDecisionRoot = this.binding.currentDecisionRoot;
    }
    return this.cachedCurrentDecisionRoot;
  }

  get nextDecisionRoot(): RootHex {
    if (this.cachedNextDecisionRoot === null) {
      this.cachedNextDecisionRoot = this.binding.nextDecisionRoot;
    }
    return this.cachedNextDecisionRoot;
  }

  getShufflingDecisionRoot(epoch: Epoch): RootHex {
    let cached = this.cachedShufflingDecisionRoot.get(epoch);
    if (cached === undefined) {
      cached = this.binding.getShufflingDecisionRoot(epoch);
      this.cachedShufflingDecisionRoot.set(epoch, cached);
    }
    return cached;
  }

  getPreviousShuffling(): EpochShuffling {
    if (this.cachedPreviousShuffling === null) {
      this.cachedPreviousShuffling = this.binding.getPreviousShuffling();
    }
    return this.cachedPreviousShuffling;
  }

  getCurrentShuffling(): EpochShuffling {
    if (this.cachedCurrentShuffling === null) {
      this.cachedCurrentShuffling = this.binding.getCurrentShuffling();
    }
    return this.cachedCurrentShuffling;
  }

  getNextShuffling(): EpochShuffling {
    if (this.cachedNextShuffling === null) {
      this.cachedNextShuffling = this.binding.getNextShuffling();
    }
    return this.cachedNextShuffling;
  }

  // Proposer shuffling

  get previousProposers(): ValidatorIndex[] | null {
    if (this.cachedPreviousProposers === undefined) {
      this.cachedPreviousProposers = this.binding.previousProposers;
    }
    return this.cachedPreviousProposers;
  }

  get currentProposers(): ValidatorIndex[] {
    if (this.cachedCurrentProposers === null) {
      this.cachedCurrentProposers = this.binding.currentProposers;
    }
    return this.cachedCurrentProposers;
  }

  get nextProposers(): ValidatorIndex[] {
    if (this.cachedNextProposers === null) {
      this.cachedNextProposers = this.binding.nextProposers;
    }
    return this.cachedNextProposers;
  }

  getBeaconProposer(slot: Slot): ValidatorIndex {
    let cached = this.cachedBeaconProposer.get(slot);
    if (cached === undefined) {
      cached = this.binding.getBeaconProposer(slot);
      this.cachedBeaconProposer.set(slot, cached);
    }
    return cached;
  }

  // Validators and balances

  get effectiveBalanceIncrements(): EffectiveBalanceIncrements {
    if (this.cachedEffectiveBalanceIncrements === null) {
      this.cachedEffectiveBalanceIncrements = this.binding.effectiveBalanceIncrements;
    }
    return this.cachedEffectiveBalanceIncrements;
  }

  getEffectiveBalanceIncrementsZeroInactive(): EffectiveBalanceIncrements {
    if (this.cachedEffectiveBalanceIncrementsZeroInactive === null) {
      this.cachedEffectiveBalanceIncrementsZeroInactive = this.binding.getEffectiveBalanceIncrementsZeroInactive();
    }
    return this.cachedEffectiveBalanceIncrementsZeroInactive;
  }

  getBalance(index: number): number {
    let cached = this.cachedBalance.get(index);
    if (cached === undefined) {
      cached = this.binding.getBalance(index);
      this.cachedBalance.set(index, cached);
    }
    return cached;
  }

  getValidator(index: ValidatorIndex): phase0.Validator {
    let cached = this.cachedValidator.get(index);
    if (cached === undefined) {
      cached = this.binding.getValidator(index);
      this.cachedValidator.set(index, cached);
    }
    return cached;
  }

  getValidatorsByStatus(statuses: Set<string>, currentEpoch: Epoch): phase0.Validator[] {
    return this.binding.getValidatorsByStatus(statuses, currentEpoch);
  }

  get validatorCount(): number {
    if (this.cachedValidatorCount === null) {
      this.cachedValidatorCount = this.binding.validatorCount;
    }
    return this.cachedValidatorCount;
  }

  get activeValidatorCount(): number {
    if (this.cachedActiveValidatorCount === null) {
      this.cachedActiveValidatorCount = this.binding.activeValidatorCount;
    }
    return this.cachedActiveValidatorCount;
  }

  getAllValidators(): phase0.Validator[] {
    if (this.cachedAllValidators === null) {
      this.cachedAllValidators = this.binding.getAllValidators();
    }
    return this.cachedAllValidators;
  }

  getAllBalances(): number[] {
    if (this.cachedAllBalances === null) {
      this.cachedAllBalances = this.binding.getAllBalances();
    }
    return this.cachedAllBalances;
  }

  // API

  get proposerRewards(): RewardCache {
    return this.binding.proposerRewards;
  }

  async computeBlockRewards(block: BeaconBlock, proposerRewards?: RewardCache): Promise<rewards.BlockRewards> {
    const isBlinded = isBlindedBeaconBlock(block);
    const signedBlockBytes = isBlinded
      ? this.config.getPostBellatrixForkTypes(block.slot).SignedBlindedBeaconBlock.serialize({
          message: block as BlindedBeaconBlock,
          signature: EMPTY_SIGNATURE,
        } as SignedBlindedBeaconBlock)
      : this.config.getForkTypes(block.slot).SignedBeaconBlock.serialize({
          message: block,
          signature: EMPTY_SIGNATURE,
        } as SignedBeaconBlock);

    return this.binding.computeBlockRewards(signedBlockBytes, isBlinded, proposerRewards);
  }

  async computeAttestationsRewards(validatorIds?: (ValidatorIndex | string)[]): Promise<rewards.AttestationsRewards> {
    return this.binding.computeAttestationsRewards(validatorIds);
  }

  getLatestWeakSubjectivityCheckpointEpoch(): Epoch {
    if (this.cachedLatestWeakSubjectivityCheckpointEpoch === null) {
      this.cachedLatestWeakSubjectivityCheckpointEpoch = this.binding.getLatestWeakSubjectivityCheckpointEpoch();
    }
    return this.cachedLatestWeakSubjectivityCheckpointEpoch;
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
    if (this.cachedFinalizedRootProof === null) {
      this.cachedFinalizedRootProof = this.binding.getFinalizedRootProof();
    }
    return this.cachedFinalizedRootProof;
  }

  getSingleProof(gindex: bigint): Uint8Array[] {
    let cached = this.cachedSingleProof.get(gindex);
    if (cached === undefined) {
      cached = this.binding.getSingleProof(gindex);
      this.cachedSingleProof.set(gindex, cached);
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
    if (this.cachedUnrealizedCheckpoints === null) {
      this.cachedUnrealizedCheckpoints = this.binding.computeUnrealizedCheckpoints();
    }
    return this.cachedUnrealizedCheckpoints;
  }

  computeAnchorCheckpoint(): {checkpoint: phase0.Checkpoint; blockHeader: phase0.BeaconBlockHeader} {
    if (this.cachedAnchorCheckpoint === null) {
      this.cachedAnchorCheckpoint = this.binding.computeAnchorCheckpoint();
    }
    return this.cachedAnchorCheckpoint;
  }

  // Backward compatibility

  get clonedCount(): number {
    return this.binding.clonedCount;
  }

  get clonedCountWithTransferCache(): number {
    return this.binding.clonedCountWithTransferCache;
  }

  get createdWithTransferCache(): boolean {
    if (this.cachedCreatedWithTransferCache === null) {
      this.cachedCreatedWithTransferCache = this.binding.createdWithTransferCache;
    }
    return this.cachedCreatedWithTransferCache;
  }

  isStateValidatorsNodesPopulated(): boolean {
    if (this.cachedIsStateValidatorsNodesPopulated === null) {
      this.cachedIsStateValidatorsNodesPopulated = this.binding.isStateValidatorsNodesPopulated();
    }
    return this.cachedIsStateValidatorsNodesPopulated;
  }

  // Serialization

  loadOtherState(
    stateBytes: Uint8Array,
    seedValidatorsBytes?: Uint8Array,
    opts?: {preloadValidatorsAndBalances?: boolean}
  ): IBeaconStateView {
    assertNativeForkSupported(this.config, getStateSlotFromBytes(stateBytes));
    return new NativeBeaconStateView(this.config, this.binding.loadOtherState(stateBytes, seedValidatorsBytes, opts));
  }

  toValue(): BeaconState {
    if (this.cachedValue === null) {
      this.cachedValue = this.binding.toValue();
    }
    return this.cachedValue;
  }

  serialize(): Uint8Array {
    if (this.cachedSerialized === null) {
      this.cachedSerialized = this.binding.serialize();
    }
    return this.cachedSerialized;
  }

  serializedSize(): number {
    if (this.cachedSerializedSize === null) {
      this.cachedSerializedSize = this.binding.serializedSize();
    }
    return this.cachedSerializedSize;
  }

  serializeToBytes(output: ByteViews, offset: number): number {
    return this.binding.serializeToBytes(output, offset);
  }

  serializeValidators(): Uint8Array {
    if (this.cachedSerializedValidators === null) {
      this.cachedSerializedValidators = this.binding.serializeValidators();
    }
    return this.cachedSerializedValidators;
  }

  serializedValidatorsSize(): number {
    if (this.cachedSerializedValidatorsSize === null) {
      this.cachedSerializedValidatorsSize = this.binding.serializedValidatorsSize();
    }
    return this.cachedSerializedValidatorsSize;
  }

  serializeValidatorsToBytes(output: ByteViews, offset: number): number {
    return this.binding.serializeValidatorsToBytes(output, offset);
  }

  hashTreeRoot(): Uint8Array {
    if (this.cachedHashTreeRoot === null) {
      this.cachedHashTreeRoot = this.binding.hashTreeRoot();
    }
    return this.cachedHashTreeRoot;
  }

  // State transition

  computeNewStateRoot(input: BlockSTFInput, modules: StateTransitionModules): ComputeNewStateRootResult {
    const postState = this.stateTransition(input, computeNewStateRootStateTransitionOpts, modules);
    return getComputeNewStateRootResult(postState);
  }

  stateTransition(
    {block, ssz}: BlockSTFInput,
    options: StateTransitionOpts,
    _modules: StateTransitionModules
  ): IBeaconStateView {
    assertNativeForkSupported(this.config, block.message.slot);
    const isBlinded = isBlindedBeaconBlock(block.message);
    const signedBlockBytes =
      ssz ??
      (isBlinded
        ? this.config
            .getPostBellatrixForkTypes(block.message.slot)
            .SignedBlindedBeaconBlock.serialize(block as SignedBlindedBeaconBlock)
        : this.config.getForkTypes(block.message.slot).SignedBeaconBlock.serialize(block as SignedBeaconBlock));
    return new NativeBeaconStateView(this.config, this.binding.stateTransition(signedBlockBytes, isBlinded, options));
  }

  processSlots(slot: Slot, opts?: {dontTransferCache?: boolean}, _modules?: StateTransitionModules): IBeaconStateView {
    assertNativeForkSupported(this.config, slot);
    return new NativeBeaconStateView(this.config, this.binding.processSlots(slot, opts));
  }

  // ─── altair ──────────────────────────────────────────────────────────────

  get previousEpochParticipation(): Uint8Array {
    if (this.cachedPreviousEpochParticipation === null) {
      this.cachedPreviousEpochParticipation = this.binding.previousEpochParticipation;
    }
    return this.cachedPreviousEpochParticipation;
  }

  get currentEpochParticipation(): Uint8Array {
    if (this.cachedCurrentEpochParticipation === null) {
      this.cachedCurrentEpochParticipation = this.binding.currentEpochParticipation;
    }
    return this.cachedCurrentEpochParticipation;
  }

  getPreviousEpochParticipation(validatorIndex: ValidatorIndex): number {
    return this.previousEpochParticipation[validatorIndex];
  }

  getCurrentEpochParticipation(validatorIndex: ValidatorIndex): number {
    return this.currentEpochParticipation[validatorIndex];
  }

  get currentSyncCommittee(): altair.SyncCommittee {
    if (this.cachedCurrentSyncCommittee === null) {
      this.cachedCurrentSyncCommittee = this.binding.currentSyncCommittee;
    }
    return this.cachedCurrentSyncCommittee;
  }

  get nextSyncCommittee(): altair.SyncCommittee {
    if (this.cachedNextSyncCommittee === null) {
      this.cachedNextSyncCommittee = this.binding.nextSyncCommittee;
    }
    return this.cachedNextSyncCommittee;
  }

  get currentSyncCommitteeIndexed(): SyncCommitteeCache {
    if (this.cachedCurrentSyncCommitteeIndexed === null) {
      this.cachedCurrentSyncCommitteeIndexed = this.binding.currentSyncCommitteeIndexed;
    }
    return this.cachedCurrentSyncCommitteeIndexed;
  }

  get syncProposerReward(): number {
    if (this.cachedSyncProposerReward === null) {
      this.cachedSyncProposerReward = this.binding.syncProposerReward;
    }
    return this.cachedSyncProposerReward;
  }

  getIndexedSyncCommitteeAtEpoch(epoch: Epoch): SyncCommitteeCache {
    let cached = this.cachedIndexedSyncCommitteeAtEpoch.get(epoch);
    if (cached === undefined) {
      cached = this.binding.getIndexedSyncCommitteeAtEpoch(epoch);
      this.cachedIndexedSyncCommitteeAtEpoch.set(epoch, cached);
    }
    return cached;
  }

  getIndexedSyncCommittee(slot: Slot): SyncCommitteeCache {
    let cached = this.cachedIndexedSyncCommittee.get(slot);
    if (cached === undefined) {
      cached = this.binding.getIndexedSyncCommittee(slot);
      this.cachedIndexedSyncCommittee.set(slot, cached);
    }
    return cached;
  }

  async computeSyncCommitteeRewards(
    block: BeaconBlock,
    validatorIds: (ValidatorIndex | string)[]
  ): Promise<rewards.SyncCommitteeRewards> {
    return this.binding.computeSyncCommitteeRewards(block, validatorIds);
  }

  getSyncCommitteesWitness(): SyncCommitteeWitness {
    if (this.cachedSyncCommitteesWitness === null) {
      this.cachedSyncCommitteesWitness = this.binding.getSyncCommitteesWitness();
    }
    return this.cachedSyncCommitteesWitness;
  }

  // ─── bellatrix ───────────────────────────────────────────────────────────

  get latestExecutionPayloadHeader(): ExecutionPayloadHeader {
    if (this.cachedLatestExecutionPayloadHeader === null) {
      this.cachedLatestExecutionPayloadHeader = this.binding.latestExecutionPayloadHeader;
    }
    return this.cachedLatestExecutionPayloadHeader;
  }

  get payloadBlockNumber(): number {
    if (this.cachedPayloadBlockNumber === null) {
      this.cachedPayloadBlockNumber = this.binding.payloadBlockNumber;
    }
    return this.cachedPayloadBlockNumber;
  }

  get isExecutionStateType(): boolean {
    if (this.cachedIsExecutionStateType === null) {
      this.cachedIsExecutionStateType = this.binding.isExecutionStateType;
    }
    return this.cachedIsExecutionStateType;
  }

  get isMergeTransitionComplete(): boolean {
    if (this.cachedIsMergeTransitionComplete === null) {
      this.cachedIsMergeTransitionComplete = this.binding.isMergeTransitionComplete;
    }
    return this.cachedIsMergeTransitionComplete;
  }

  isExecutionEnabled(block: BeaconBlock | BlindedBeaconBlock): boolean {
    return this.binding.isExecutionEnabled(block);
  }

  // ─── capella ─────────────────────────────────────────────────────────────

  get historicalSummaries(): capella.HistoricalSummaries {
    if (this.cachedHistoricalSummaries === null) {
      this.cachedHistoricalSummaries = this.binding.historicalSummaries;
    }
    return this.cachedHistoricalSummaries;
  }

  getExpectedWithdrawals(): {
    expectedWithdrawals: capella.Withdrawal[];
    processedBuilderWithdrawalsCount: number;
    processedPartialWithdrawalsCount: number;
    processedBuildersSweepCount: number;
    processedValidatorSweepCount: number;
  } {
    if (this.cachedExpectedWithdrawals === null) {
      this.cachedExpectedWithdrawals = this.binding.getExpectedWithdrawals();
    }
    return this.cachedExpectedWithdrawals;
  }

  // ─── electra ─────────────────────────────────────────────────────────────

  get pendingDeposits(): electra.PendingDeposits {
    if (this.cachedPendingDeposits === null) {
      const type = this.forkSeq >= ForkSeq.gloas ? ssz.gloas.PendingDeposits : ssz.electra.PendingDeposits;
      this.cachedPendingDeposits = type.deserialize(this.binding.pendingDeposits);
    }
    return this.cachedPendingDeposits;
  }

  get pendingDepositsCount(): number {
    if (this.cachedPendingDepositsCount === null) {
      this.cachedPendingDepositsCount = this.binding.pendingDepositsCount;
    }
    return this.cachedPendingDepositsCount;
  }

  get pendingPartialWithdrawals(): electra.PendingPartialWithdrawals {
    if (this.cachedPendingPartialWithdrawals === null) {
      const type =
        this.forkSeq >= ForkSeq.gloas ? ssz.gloas.PendingPartialWithdrawals : ssz.electra.PendingPartialWithdrawals;
      this.cachedPendingPartialWithdrawals = type.deserialize(this.binding.pendingPartialWithdrawals);
    }
    return this.cachedPendingPartialWithdrawals;
  }

  get pendingPartialWithdrawalsCount(): number {
    if (this.cachedPendingPartialWithdrawalsCount === null) {
      this.cachedPendingPartialWithdrawalsCount = this.binding.pendingPartialWithdrawalsCount;
    }
    return this.cachedPendingPartialWithdrawalsCount;
  }

  get pendingConsolidations(): electra.PendingConsolidations {
    if (this.cachedPendingConsolidations === null) {
      const type = this.forkSeq >= ForkSeq.gloas ? ssz.gloas.PendingConsolidations : ssz.electra.PendingConsolidations;
      this.cachedPendingConsolidations = type.deserialize(this.binding.pendingConsolidations);
    }
    return this.cachedPendingConsolidations;
  }

  get pendingConsolidationsCount(): number {
    if (this.cachedPendingConsolidationsCount === null) {
      this.cachedPendingConsolidationsCount = this.binding.pendingConsolidationsCount;
    }
    return this.cachedPendingConsolidationsCount;
  }

  // ─── fulu ────────────────────────────────────────────────────────────────

  get proposerLookahead(): fulu.ProposerLookahead {
    if (this.cachedProposerLookahead === null) {
      this.cachedProposerLookahead = Array.from(this.binding.proposerLookahead);
    }
    return this.cachedProposerLookahead;
  }

  preVerifyBuilderDepositsPreGloas(
    _maxBuilderDeposits: number,
    _maxDurationMs: number
  ): PreVerifyBuilderDepositsResult {
    // The native fork upgrade verifies directly; it does not maintain a warm-up cache.
    return {
      validBuilderSignaturesCount: 0,
      invalidBuilderSignaturesCount: 0,
      validValidatorSignaturesCount: 0,
      invalidValidatorSignaturesCount: 0,
      scannedPendingDeposits: 0,
      totalCachedDeposits: 0,
      totalBuilderPubkeys: 0,
      pendingDepositsCount: this.pendingDepositsCount,
    };
  }

  clearPreGloasBuilderDepositCache(): void {
    // The native implementation has no pre-Gloas deposit cache to clear.
  }

  // ─── gloas ───────────────────────────────────────────────────────────────

  get latestBlockHash(): Bytes32 {
    if (this.cachedLatestBlockHash === null) {
      this.cachedLatestBlockHash = this.binding.latestBlockHash;
    }
    return this.cachedLatestBlockHash;
  }

  get latestExecutionPayloadBid(): ExecutionPayloadBid {
    if (this.cachedLatestExecutionPayloadBid === null) {
      this.cachedLatestExecutionPayloadBid = this.binding.latestExecutionPayloadBid;
    }
    return this.cachedLatestExecutionPayloadBid;
  }

  get payloadExpectedWithdrawals(): capella.Withdrawal[] {
    if (this.cachedPayloadExpectedWithdrawals === null) {
      this.cachedPayloadExpectedWithdrawals = this.binding.payloadExpectedWithdrawals;
    }
    return this.cachedPayloadExpectedWithdrawals;
  }

  get builderPendingPayments(): gloas.BuilderPendingPayments {
    if (this.cachedBuilderPendingPayments === null) {
      this.cachedBuilderPendingPayments = this.binding.builderPendingPayments;
    }
    return this.cachedBuilderPendingPayments;
  }

  get builderPendingWithdrawals(): gloas.BuilderPendingWithdrawals {
    if (this.cachedBuilderPendingWithdrawals === null) {
      this.cachedBuilderPendingWithdrawals = this.binding.builderPendingWithdrawals;
    }
    return this.cachedBuilderPendingWithdrawals;
  }

  getBuilder(index: BuilderIndex): gloas.Builder {
    return this.binding.getBuilder(index);
  }

  getBuildersLength(): number {
    if (this.cachedBuildersLength === null) {
      this.cachedBuildersLength = this.binding.getBuildersLength();
    }
    return this.cachedBuildersLength;
  }

  canBuilderCoverBid(builderIndex: BuilderIndex, bidAmount: number): boolean {
    return this.binding.canBuilderCoverBid(builderIndex, bidAmount);
  }

  getEpochPTCs(epoch: Epoch): Uint32Array[] {
    return this.binding.getEpochPTCs(epoch);
  }

  getPayloadTimelinessCommittee(slot: Slot): Uint32Array {
    return this.binding.getPayloadTimelinessCommittee(slot);
  }

  getIndicesInPayloadTimelinessCommittee(validatorIndex: ValidatorIndex, slot: Slot): number[] {
    return this.binding.getIndicesInPayloadTimelinessCommittee(validatorIndex, slot);
  }

  withParentPayloadApplied(executionRequests: gloas.ExecutionRequests): IBeaconStateViewGloas {
    const bytes = ssz.gloas.ExecutionRequests.serialize(executionRequests);
    const state = new NativeBeaconStateView(this.config, this.binding.withParentPayloadApplied(bytes));
    if (!isStatePostGloas(state)) {
      state.release();
      throw Error("Expected Gloas state after applying the parent payload");
    }
    return state;
  }
}
