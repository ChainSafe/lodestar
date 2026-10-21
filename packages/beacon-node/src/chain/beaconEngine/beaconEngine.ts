import {CompactMultiProof} from "@chainsafe/persistent-merkle-tree";
import {routes} from "@lodestar/api";
import {BeaconConfig} from "@lodestar/config";
import {CheckpointWithHex, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {ForkName, ForkPostBellatrix, ForkPreGloas, ForkSeq} from "@lodestar/params";
import {DataAvailabilityStatus, EffectiveBalanceIncrements} from "@lodestar/state-transition";
import {
  Attestation,
  AttesterSlashing,
  BeaconBlock,
  BlindedBeaconBlock,
  Bytes32,
  CommitteeIndex,
  Epoch,
  IndexedAttestation,
  Root,
  RootHex,
  SignedAggregateAndProof,
  SignedBeaconBlock,
  SingleAttestation,
  Slot,
  SubcommitteeIndex,
  SubnetID,
  ValidatorIndex,
  altair,
  capella,
  electra,
  fulu,
  gloas,
  phase0,
  rewards,
} from "@lodestar/types";
import {CommitteeSubscription} from "../../network/subnets/interface.js";
import {IClock} from "../../util/clock.js";
import {SerializedCache} from "../../util/serializedCache.js";
import {ProposerPreparationData} from "../beaconProposerCache.js";
import {BlockInputSource, IBlockInput} from "../blocks/blockInput/index.js";
import {PayloadImportError} from "../blocks/importExecutionPayload.js";
import {PayloadEnvelopeInput} from "../blocks/payloadEnvelopeInput/index.js";
import {SourceMeta} from "../blocks/payloadEnvelopeInput/types.js";
import {SignedBlockRoot, computeSignedBlockRoot} from "../blocks/signedBlockRoot.js";
import {ImportBlockOpts} from "../blocks/types.js";
import {SegmentExecStatus} from "../blocks/verifyBlocksExecutionPayloads.js";
import {ChainViewSnapshot, ChainViewUpdate, FinalizedProtoSummary} from "../chainView/interface.js";
import {ChainEvent, ChainEventEmitter} from "../emitter.js";
import {BlockError} from "../errors/index.js";
import {ForkchoiceCaller} from "../forkChoice/index.js";
import {InsertOutcome} from "../opPools/types.js";
import {RegenRequest} from "../regen/index.js";
import {ApiAttestation, AttestationValidationResult, GossipAttestation} from "../validation/attestation.js";
import {ApiVoluntaryExitResult} from "../validation/voluntaryExit.js";
import {ValidatorMonitorAttestation, ValidatorMonitorBlock} from "../validatorMonitor.js";
import type {BeaconEngineCore} from "./beaconEngineCore.js";
import {BeaconEngineEvent, ChainReorg, ExecutionPayloadImported, FastConfirmation, HeadUpdate} from "./events.js";
import {GossipBlockResult} from "./gossipValidation/block.js";
import {GossipValidationResult} from "./gossipValidationResult.js";
import {AnchorSummary, EngineBootstrap} from "./initialization.js";
import {
  ApiStateId,
  ApiStateResult,
  ApiStateResultWithFork,
  HeadParentPayload,
  IBeaconEngine,
  ImportBlockResult,
  ImportExecutionPayloadOpts,
  PrepareNextSlotOpts,
  PrepareNextSlotResponse,
  ProduceBlockRequest,
  ProduceBlockResponse,
  ProduceBlockV4Request,
  ProduceBlockV4Response,
  SerializedLightClientData,
  VerifyBlocksOpts,
} from "./interface.js";
import {blockErrorFromFailure} from "./processingResult.js";

const EVENTSTREAM_EMIT_RECENT_EXECUTION_PAYLOAD_SLOTS = 64;

export type BeaconEngineModules = {
  core: BeaconEngineCore;
  config: BeaconConfig;
  emitter: ChainEventEmitter;
  clock: IClock;
  serializedCache: SerializedCache;
};

export class BeaconEngine implements IBeaconEngine {
  readonly config: BeaconConfig;
  private readonly core: BeaconEngineCore;
  private readonly emitter: ChainEventEmitter;
  private readonly clock: IClock;
  private readonly serializedCache: SerializedCache;

  constructor({core, config, emitter, clock, serializedCache}: BeaconEngineModules) {
    this.core = core;
    this.config = config;
    this.emitter = emitter;
    this.clock = clock;
    this.serializedCache = serializedCache;
    // TODO - beacon engine: in worker mode, post core notifications to a main-thread event bus,
    // preserving their order so ChainView is updated before head/head_v2 consumers run.
    this.core.emitter.on(BeaconEngineEvent.chainViewUpdated, this.onChainViewUpdated);
    this.core.emitter.on(BeaconEngineEvent.earliestAvailableSlotUpdated, this.onEarliestAvailableSlotUpdated);
    this.core.emitter.on(BeaconEngineEvent.fatalError, this.onFatalError);
    this.core.emitter.on(BeaconEngineEvent.builderRegistered, this.onBuilderRegistered);
    this.core.emitter.on(BeaconEngineEvent.headUpdated, this.onHeadUpdated);
    this.core.emitter.on(BeaconEngineEvent.chainReorg, this.onChainReorg);
    this.core.emitter.on(BeaconEngineEvent.proposerSlashingProduced, this.onProposerSlashingProduced);
    this.core.emitter.on(BeaconEngineEvent.fastConfirmation, this.onFastConfirmation);
    this.core.emitter.on(BeaconEngineEvent.lightClientOptimisticUpdate, this.onLightClientOptimisticUpdate);
    this.core.emitter.on(BeaconEngineEvent.lightClientFinalityUpdate, this.onLightClientFinalityUpdate);
    this.core.emitter.on(BeaconEngineEvent.executionPayloadImported, this.onExecutionPayloadImported);
  }

  async close(): Promise<void> {
    try {
      await this.core.close();
    } finally {
      this.core.emitter.off(BeaconEngineEvent.chainViewUpdated, this.onChainViewUpdated);
      this.core.emitter.off(BeaconEngineEvent.earliestAvailableSlotUpdated, this.onEarliestAvailableSlotUpdated);
      this.core.emitter.off(BeaconEngineEvent.fatalError, this.onFatalError);
      this.core.emitter.off(BeaconEngineEvent.builderRegistered, this.onBuilderRegistered);
      this.core.emitter.off(BeaconEngineEvent.headUpdated, this.onHeadUpdated);
      this.core.emitter.off(BeaconEngineEvent.chainReorg, this.onChainReorg);
      this.core.emitter.off(BeaconEngineEvent.proposerSlashingProduced, this.onProposerSlashingProduced);
      this.core.emitter.off(BeaconEngineEvent.fastConfirmation, this.onFastConfirmation);
      this.core.emitter.off(BeaconEngineEvent.lightClientOptimisticUpdate, this.onLightClientOptimisticUpdate);
      this.core.emitter.off(BeaconEngineEvent.lightClientFinalityUpdate, this.onLightClientFinalityUpdate);
      this.core.emitter.off(BeaconEngineEvent.executionPayloadImported, this.onExecutionPayloadImported);
    }
  }

  private readonly onChainViewUpdated = (update: ChainViewUpdate): void => {
    this.emitter.emit(ChainEvent.chainViewUpdated, update);
  };

  private readonly onEarliestAvailableSlotUpdated = (slot: Slot): void => {
    this.emitter.emit(ChainEvent.earliestAvailableSlotUpdated, slot);
  };

  private readonly onBuilderRegistered = (url: string): void => {
    // Worker transport must deliver registration before resolving production, so publication can use the URL.
    this.emitter.emit(ChainEvent.builderRegistered, url);
  };

  private readonly onFatalError = (error: Error): void => {
    this.emitter.emit(ChainEvent.fatalError, error);
  };

  private readonly onHeadUpdated = (update: HeadUpdate): void => {
    const {
      slot,
      blockRoot,
      stateRoot,
      payloadStatus,
      headRootChanged,
      epochTransition,
      previousDutyDependentRoot,
      currentDutyDependentRoot,
      executionOptimistic,
    } = update;
    if (headRootChanged) {
      this.emitter.emit(routes.events.EventType.head, {
        slot,
        block: blockRoot,
        state: stateRoot,
        epochTransition,
        previousDutyDependentRoot,
        currentDutyDependentRoot,
        executionOptimistic,
      });
    }
    this.emitter.emit(routes.events.EventType.headV2, {
      version: this.config.getForkName(slot),
      data: {
        slot,
        block: blockRoot,
        state: stateRoot,
        payloadStatus: payloadStatus === PayloadStatus.FULL ? "full" : "empty",
        epochTransition,
        currentEpochDependentRoot: previousDutyDependentRoot,
        nextEpochDependentRoot: currentDutyDependentRoot,
        executionOptimistic,
      },
    });
  };

  private readonly onChainReorg = (reorg: ChainReorg): void => {
    this.emitter.emit(routes.events.EventType.chainReorg, reorg);
  };

  private readonly onProposerSlashingProduced = (slashing: phase0.ProposerSlashing): void => {
    this.emitter.emit(routes.events.EventType.proposerSlashing, slashing);
    this.emitter.emit(ChainEvent.publishProposerSlashing, slashing);
  };

  private readonly onFastConfirmation = (confirmation: FastConfirmation): void => {
    this.emitter.emit(routes.events.EventType.fastConfirmation, confirmation);
  };

  private readonly onLightClientOptimisticUpdate = ({data, slot}: SerializedLightClientData): void => {
    this.emitter.emit(routes.events.EventType.lightClientOptimisticUpdate, {
      version: this.config.getForkName(slot),
      data: this.config.getPostAltairForkTypes(slot).LightClientOptimisticUpdate.deserialize(data),
    });
  };

  private readonly onLightClientFinalityUpdate = ({data, slot}: SerializedLightClientData): void => {
    this.emitter.emit(routes.events.EventType.lightClientFinalityUpdate, {
      version: this.config.getForkName(slot),
      data: this.config.getPostAltairForkTypes(slot).LightClientFinalityUpdate.deserialize(data),
    });
  };

  // Source: unstable@1bf214377e chain/blocks/importExecutionPayload.ts, post-import event emission.
  private readonly onExecutionPayloadImported = (event: ExecutionPayloadImported): void => {
    if (this.clock.currentSlot - event.slot < EVENTSTREAM_EMIT_RECENT_EXECUTION_PAYLOAD_SLOTS) {
      this.emitter.emit(routes.events.EventType.executionPayload, event);
    }
  };

  prepareAnchorState(stateBytes: Uint8Array): Promise<AnchorSummary> {
    return this.core.prepareAnchorState(stateBytes);
  }

  persistAnchorState(): Promise<void> {
    return this.core.persistAnchorState();
  }

  initializeFromAnchor(): Promise<EngineBootstrap> {
    return this.core.initializeFromAnchor();
  }

  getChainViewSnapshot(): Promise<ChainViewSnapshot> {
    return this.core.getChainViewSnapshot();
  }

  getLightClientBootstrap(blockRoot: Root): Promise<SerializedLightClientData> {
    return this.core.getLightClientBootstrap(blockRoot);
  }

  getLightClientUpdate(period: number): Promise<SerializedLightClientData> {
    return this.core.getLightClientUpdate(period);
  }

  getLightClientOptimisticUpdate(): Promise<SerializedLightClientData | null> {
    return this.core.getLightClientOptimisticUpdate();
  }

  getLightClientFinalityUpdate(): Promise<SerializedLightClientData | null> {
    return this.core.getLightClientFinalityUpdate();
  }

  getLightClientCommitteeRoot(period: number): Promise<Root> {
    return this.core.getLightClientCommitteeRoot(period);
  }

  pruneLightClientNonCheckpointData(roots: Root[]): Promise<void> {
    return this.core.pruneLightClientNonCheckpointData(roots);
  }

  validateGossipLightClientOptimisticUpdate(bytes: Uint8Array, fork: ForkName): Promise<GossipValidationResult<void>> {
    return this.core.validateGossipLightClientOptimisticUpdate(bytes, fork);
  }

  validateGossipLightClientFinalityUpdate(bytes: Uint8Array, fork: ForkName): Promise<GossipValidationResult<void>> {
    return this.core.validateGossipLightClientFinalityUpdate(bytes, fork);
  }

  getHeads(): Promise<ProtoBlock[]> {
    return this.core.getHeads();
  }

  getDebugForkChoice(): Promise<routes.debug.ForkChoiceResponse> {
    return this.core.getDebugForkChoice();
  }

  getDebugForkChoiceV2(): Promise<routes.debug.ForkChoiceResponseV2> {
    return this.core.getDebugForkChoiceV2();
  }

  getFastConfirmationInfo(): Promise<routes.lodestar.FastConfirmationInfo> {
    return this.core.getFastConfirmationInfo();
  }

  getProtoArrayNodes(): Promise<routes.debug.ProtoNodeList> {
    return this.core.getProtoArrayNodes();
  }

  pauseFastConfirmation(): void {
    this.core.pauseFastConfirmation();
  }

  resumeFastConfirmation(): void {
    this.core.resumeFastConfirmation();
  }

  persistArchiveBlock(
    slot: Slot,
    serializedBytes: Uint8Array,
    blockRoot: Uint8Array,
    parentRoot: Uint8Array
  ): Promise<void> {
    return this.core.persistArchiveBlock(slot, serializedBytes, blockRoot, parentRoot);
  }

  batchPersistArchiveBlocks(
    entries: {slot: Slot; bytes: Uint8Array; blockRoot: Uint8Array; parentRoot: Uint8Array}[]
  ): Promise<void> {
    return this.core.batchPersistArchiveBlocks(entries);
  }

  produceBlock(request: ProduceBlockRequest): Promise<ProduceBlockResponse> {
    return this.core.produceBlock(request);
  }

  produceBlockV4(request: ProduceBlockV4Request): Promise<ProduceBlockV4Response> {
    return this.core.produceBlockV4(request);
  }

  registerAuthenticatedBuilder(url: string): Promise<void> {
    return this.core.registerAuthenticatedBuilder(url);
  }

  registerValidator(epoch: Epoch, registrationsBytes: Uint8Array): Promise<void> {
    return this.core.registerValidator(epoch, registrationsBytes);
  }

  submitBlindedBlock(signedBlindedBlockBytes: Uint8Array, fork: ForkPostBellatrix & ForkPreGloas): Promise<Uint8Array> {
    return this.core.submitBlindedBlock(signedBlindedBlockBytes, fork);
  }

  submitBlindedBlockNoResponse(
    signedBlindedBlockBytes: Uint8Array,
    fork: ForkPostBellatrix & ForkPreGloas
  ): Promise<void> {
    return this.core.submitBlindedBlockNoResponse(signedBlindedBlockBytes, fork);
  }

  prepareForNextSlot(clockSlot: Slot, opts: PrepareNextSlotOpts): Promise<PrepareNextSlotResponse> {
    return this.core.prepareForNextSlot(clockSlot, opts);
  }

  getProposerDuties(
    epoch: Epoch,
    timing: {currentEpoch: Epoch; checkpointWaitTimeoutMs?: number},
    v2: boolean
  ): Promise<{data: routes.validator.ProposerDuty[]; dependentRoot: Root; head: ProtoBlock}> {
    return this.core.getProposerDuties(epoch, timing, v2);
  }

  getAttesterDuties(
    epoch: Epoch,
    indices: ValidatorIndex[],
    currentEpoch: Epoch
  ): Promise<{data: routes.validator.AttesterDuty[]; dependentRoot: Root; head: ProtoBlock}> {
    return this.core.getAttesterDuties(epoch, indices, currentEpoch);
  }

  getSyncCommitteeDuties(
    epoch: Epoch,
    indices: ValidatorIndex[]
  ): Promise<{data: routes.validator.SyncDuty[]; head: ProtoBlock}> {
    return this.core.getSyncCommitteeDuties(epoch, indices);
  }

  getPtcDuties(
    epoch: Epoch,
    indices: ValidatorIndex[],
    currentEpoch: Epoch
  ): Promise<{data: routes.validator.PtcDuty[]; dependentRoot: Root; head: ProtoBlock}> {
    return this.core.getPtcDuties(epoch, indices, currentEpoch);
  }

  dumpCacheSummary(): Promise<routes.lodestar.StateCacheItem[]> {
    return this.core.dumpCacheSummary();
  }

  dropCache(): Promise<void> {
    return this.core.dropCache();
  }

  dumpRegenQueueItems(): Promise<{key: RegenRequest["key"]; args: RegenRequest; addedTimeMs: number}[]> {
    return this.core.dumpRegenQueueItems();
  }

  registerLocalValidators(indices: ValidatorIndex[]): Promise<void> {
    return this.core.registerLocalValidators(indices);
  }

  registerLocalValidatorsInSyncCommittee(
    subscriptions: {validatorIndex: ValidatorIndex; untilEpoch: Epoch}[]
  ): Promise<void> {
    return this.core.registerLocalValidatorsInSyncCommittee(subscriptions);
  }

  registerApiBlock(seenTimestampSec: number, block: ValidatorMonitorBlock): Promise<void> {
    return this.core.registerApiBlock(seenTimestampSec, block);
  }

  registerApiExecutionPayloadEnvelope(
    delaySec: number,
    signedExecutionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope
  ): Promise<void> {
    return this.core.registerApiExecutionPayloadEnvelope(delaySec, signedExecutionPayloadEnvelope);
  }

  onPoolSubmitUnaggregatedAttestation(
    seenTimestampSec: number,
    attestation: ValidatorMonitorAttestation,
    subnet: SubnetID,
    sentPeers: number
  ): Promise<void> {
    return this.core.onPoolSubmitUnaggregatedAttestation(seenTimestampSec, attestation, subnet, sentPeers);
  }

  onPoolSubmitAggregatedAttestation(
    seenTimestampSec: number,
    attestation: ValidatorMonitorAttestation,
    sentPeers: number
  ): Promise<void> {
    return this.core.onPoolSubmitAggregatedAttestation(seenTimestampSec, attestation, sentPeers);
  }

  getMonitoredValidatorIndices(): Promise<ValidatorIndex[]> {
    return this.core.getMonitoredValidatorIndices();
  }

  scrapeMetrics(): ReturnType<IBeaconEngine["scrapeMetrics"]> {
    return this.core.scrapeMetrics();
  }

  initRegen(): Promise<void> {
    return this.core.initRegen();
  }

  getHeadExecutionStateInfo(): Promise<{isExecutionStateType: boolean; isMergeTransitionComplete: boolean}> {
    return this.core.getHeadExecutionStateInfo();
  }

  getLatestWeakSubjectivityCheckpointEpoch(): Promise<Epoch> {
    return this.core.getLatestWeakSubjectivityCheckpointEpoch();
  }

  loadHistoricalStateRegen(): Promise<void> {
    return this.core.loadHistoricalStateRegen();
  }

  getPersistedCheckpointState(checkpoint?: phase0.Checkpoint): Promise<Uint8Array | null> {
    return this.core.getPersistedCheckpointState(checkpoint);
  }

  getSerializedState(
    id: ApiStateId
  ): Promise<{state: Uint8Array; executionOptimistic: boolean; finalized: boolean} | null> {
    return this.core.getSerializedState(id);
  }

  getFinalizedEffectiveBalances(
    finalizedCheckpoint: CheckpointWithHex,
    validatorIndices: ValidatorIndex[]
  ): Promise<number[] | null> {
    return this.core.getFinalizedEffectiveBalances(finalizedCheckpoint, validatorIndices);
  }

  getStateProof(id: ApiStateId, descriptor: Uint8Array): Promise<{proof: CompactMultiProof; fork: ForkName} | null> {
    return this.core.getStateProof(id, descriptor);
  }

  getHistoricalSummaries(id: ApiStateId): Promise<{
    slot: Slot;
    historicalSummaries: capella.HistoricalSummaries;
    proof: Uint8Array[];
    fork: ForkName;
    executionOptimistic: boolean;
    finalized: boolean;
  } | null> {
    return this.core.getHistoricalSummaries(id);
  }

  getIndexedAttestationsForSlashing(
    requests: {slot: Slot; epoch: Epoch; attestations: Attestation[]}[],
    forkSeq: ForkSeq
  ): Promise<IndexedAttestation[]> {
    return this.core.getIndexedAttestationsForSlashing(requests, forkSeq);
  }

  getStateBuilders(
    id: ApiStateId,
    builderIds: routes.beacon.BuilderId[],
    statuses: string[]
  ): Promise<ApiStateResult<routes.beacon.BuilderResponse[]>> {
    return this.core.getStateBuilders(id, builderIds, statuses);
  }

  getStateRoot(id: ApiStateId): Promise<ApiStateResult<{root: Root}>> {
    return this.core.getStateRoot(id);
  }

  getStateFork(id: ApiStateId): Promise<ApiStateResult<phase0.Fork>> {
    return this.core.getStateFork(id);
  }

  getStateRandao(id: ApiStateId, epoch?: Epoch): Promise<ApiStateResult<{randao: Bytes32}>> {
    return this.core.getStateRandao(id, epoch);
  }

  getStateFinalityCheckpoints(id: ApiStateId): Promise<
    ApiStateResult<{
      currentJustified: phase0.Checkpoint;
      previousJustified: phase0.Checkpoint;
      finalized: phase0.Checkpoint;
    }>
  > {
    return this.core.getStateFinalityCheckpoints(id);
  }

  getStateValidators(
    id: ApiStateId,
    validatorIds: routes.beacon.ValidatorId[],
    statuses: string[]
  ): Promise<ApiStateResult<routes.beacon.ValidatorResponse[]>> {
    return this.core.getStateValidators(id, validatorIds, statuses);
  }

  getStateValidatorIdentities(
    id: ApiStateId,
    validatorIds: routes.beacon.ValidatorId[]
  ): Promise<ApiStateResult<routes.beacon.ValidatorIdentities>> {
    return this.core.getStateValidatorIdentities(id, validatorIds);
  }

  getStateValidator(
    id: ApiStateId,
    validatorId: routes.beacon.ValidatorId
  ): Promise<ApiStateResult<routes.beacon.ValidatorResponse>> {
    return this.core.getStateValidator(id, validatorId);
  }

  getStateValidatorBalances(
    id: ApiStateId,
    validatorIds: routes.beacon.ValidatorId[]
  ): Promise<ApiStateResult<routes.beacon.ValidatorBalance[]>> {
    return this.core.getStateValidatorBalances(id, validatorIds);
  }

  getEpochCommittees(
    id: ApiStateId,
    filters: {epoch?: Epoch; index?: CommitteeIndex; slot?: Slot}
  ): Promise<ApiStateResult<routes.beacon.EpochCommitteeResponse[]>> {
    return this.core.getEpochCommittees(id, filters);
  }

  getStatePtc(id: ApiStateId, slot?: Slot): Promise<ApiStateResult<{slot: Slot; validators: ValidatorIndex[]}>> {
    return this.core.getStatePtc(id, slot);
  }

  getEpochSyncCommittees(
    id: ApiStateId,
    epoch?: Epoch
  ): Promise<ApiStateResult<routes.beacon.EpochSyncCommitteeResponse>> {
    return this.core.getEpochSyncCommittees(id, epoch);
  }

  getStatePendingDeposits(
    id: ApiStateId,
    returnBytes: boolean
  ): Promise<ApiStateResultWithFork<Uint8Array | electra.PendingDeposits>> {
    return this.core.getStatePendingDeposits(id, returnBytes);
  }

  getStatePendingPartialWithdrawals(
    id: ApiStateId,
    returnBytes: boolean
  ): Promise<ApiStateResultWithFork<Uint8Array | electra.PendingPartialWithdrawals>> {
    return this.core.getStatePendingPartialWithdrawals(id, returnBytes);
  }

  getStatePendingConsolidations(
    id: ApiStateId,
    returnBytes: boolean
  ): Promise<ApiStateResultWithFork<Uint8Array | electra.PendingConsolidations>> {
    return this.core.getStatePendingConsolidations(id, returnBytes);
  }

  getStateProposerLookahead(
    id: ApiStateId,
    returnBytes: boolean
  ): Promise<ApiStateResultWithFork<Uint8Array | fulu.ProposerLookahead>> {
    return this.core.getStateProposerLookahead(id, returnBytes);
  }

  getHeadProposerPubkey(slot: Slot): Promise<Uint8Array> {
    return this.core.getHeadProposerPubkey(slot);
  }

  getBuilderPendingPayments(
    id: ApiStateId,
    returnBytes: boolean
  ): Promise<ApiStateResultWithFork<Uint8Array | gloas.BuilderPendingPayments>> {
    return this.core.getBuilderPendingPayments(id, returnBytes);
  }

  getBuilderPendingWithdrawals(
    id: ApiStateId,
    returnBytes: boolean
  ): Promise<ApiStateResultWithFork<Uint8Array | gloas.BuilderPendingWithdrawals>> {
    return this.core.getBuilderPendingWithdrawals(id, returnBytes);
  }

  getHeadParentPayload(): Promise<HeadParentPayload | undefined> {
    return this.core.getHeadParentPayload();
  }

  getActiveOrPendingValidators(indices: ValidatorIndex[]): Promise<Set<ValidatorIndex>> {
    return this.core.getActiveOrPendingValidators(indices);
  }

  getAttestationSourceCheckpoint(attEpoch: Epoch): Promise<phase0.Checkpoint> {
    return this.core.getAttestationSourceCheckpoint(attEpoch);
  }

  getBlockRewards(block: BeaconBlock | BlindedBeaconBlock): Promise<rewards.BlockRewards> {
    return this.core.getBlockRewards(block);
  }

  getAttestationsRewards(
    epoch: Epoch,
    validatorIds?: (ValidatorIndex | string)[]
  ): Promise<{rewards: rewards.AttestationsRewards; executionOptimistic: boolean; finalized: boolean}> {
    return this.core.getAttestationsRewards(epoch, validatorIds);
  }

  getSyncCommitteeRewards(
    block: BeaconBlock | BlindedBeaconBlock,
    validatorIds?: (ValidatorIndex | string)[]
  ): Promise<rewards.SyncCommitteeRewards> {
    return this.core.getSyncCommitteeRewards(block, validatorIds);
  }

  validateGossipBlock(
    signedBlock: SignedBeaconBlock,
    blockBytes: Uint8Array,
    fork: ForkName,
    seenTimestampSec?: number
  ): Promise<GossipBlockResult> {
    return this.core.validateGossipBlock(computeSignedBlockRoot(fork, signedBlock), blockBytes, fork, seenTimestampSec);
  }

  validateGossipSyncCommittee(syncCommitteeBytes: Uint8Array, subnet: SubnetID): Promise<GossipValidationResult<void>> {
    return this.core.validateGossipSyncCommittee(syncCommitteeBytes, subnet);
  }

  validateApiSyncCommittee(
    syncCommitteeBytes: Uint8Array,
    syncCommittee: altair.SyncCommitteeMessage
  ): Promise<GossipValidationResult<{subnets: number[]}>> {
    return this.core.validateApiSyncCommittee(syncCommitteeBytes, syncCommittee);
  }

  validateSyncCommitteeGossipContributionAndProof(
    contributionBytes: Uint8Array,
    skipValidationKnownParticipants?: boolean
  ): Promise<GossipValidationResult<{syncCommitteeParticipantIndices: ValidatorIndex[]}>> {
    return this.core.validateSyncCommitteeGossipContributionAndProof(
      contributionBytes,
      skipValidationKnownParticipants
    );
  }

  validateApiSyncCommitteeContributionAndProof(
    contributionBytes: Uint8Array,
    signedContributionAndProof: altair.SignedContributionAndProof
  ): Promise<GossipValidationResult<void>> {
    return this.core.validateApiSyncCommitteeContributionAndProof(contributionBytes, signedContributionAndProof);
  }

  validateGossipBlobSidecar(
    blobBytes: Uint8Array,
    fork: ForkName,
    subnet: SubnetID
  ): Promise<GossipValidationResult<void>> {
    return this.core.validateGossipBlobSidecar(blobBytes, fork, subnet);
  }

  validateGossipFuluDataColumnSidecar(
    dataColumnBytes: Uint8Array,
    gossipSubnet: SubnetID
  ): Promise<GossipValidationResult<void>> {
    return this.core.validateGossipFuluDataColumnSidecar(dataColumnBytes, gossipSubnet);
  }

  validateGossipGloasDataColumnSidecar(
    dataColumnBytes: Uint8Array,
    gossipSubnet: SubnetID
  ): Promise<GossipValidationResult<void>> {
    return this.core.validateGossipGloasDataColumnSidecar(dataColumnBytes, gossipSubnet);
  }

  validateGossipPayloadAttestationMessage(payloadAttestationBytes: Uint8Array): Promise<GossipValidationResult<void>> {
    return this.core.validateGossipPayloadAttestationMessage(payloadAttestationBytes);
  }

  validateApiPayloadAttestationMessage(
    payloadAttestationBytes: Uint8Array,
    payloadAttestationMessage: gloas.PayloadAttestationMessage
  ): Promise<GossipValidationResult<void>> {
    return this.core.validateApiPayloadAttestationMessage(payloadAttestationBytes, payloadAttestationMessage);
  }

  validateGossipAttestationsSameAttData(
    fork: ForkName,
    attestations: GossipAttestation[],
    seenTimestampSecs: number[]
  ): Promise<{results: GossipValidationResult<AttestationValidationResult>[]; batchableBls: boolean}> {
    return this.core.validateGossipAttestationsSameAttData(fork, attestations, seenTimestampSecs);
  }

  prepareBeaconCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void> {
    return this.core.prepareBeaconCommitteeSubnets(subscriptions);
  }

  validateApiAttestation(
    fork: ForkName,
    attestationOrBytes: ApiAttestation
  ): Promise<GossipValidationResult<AttestationValidationResult>> {
    return this.core.validateApiAttestation(fork, attestationOrBytes);
  }

  validateGossipAggregateAndProof(
    aggregateBytes: Uint8Array,
    fork: ForkName,
    seenTimestampSec: number
  ): Promise<GossipValidationResult<{indexedAttestation: IndexedAttestation}>> {
    return this.core.validateGossipAggregateAndProof(aggregateBytes, fork, seenTimestampSec);
  }

  validateApiAggregateAndProof(
    aggregateBytes: Uint8Array,
    fork: ForkName,
    signedAggregateAndProof: SignedAggregateAndProof
  ): Promise<GossipValidationResult<{indexedAttestation: IndexedAttestation}>> {
    return this.core.validateApiAggregateAndProof(aggregateBytes, fork, signedAggregateAndProof);
  }

  validateGossipExecutionPayloadEnvelope(
    envelopeBytes: Uint8Array,
    source: SourceMeta
  ): Promise<GossipValidationResult<void>> {
    return this.core.validateGossipExecutionPayloadEnvelope(envelopeBytes, source);
  }

  validateApiExecutionPayloadEnvelope(
    envelopeBytes: Uint8Array,
    executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope,
    seenTimestampSec: number
  ): Promise<GossipValidationResult<void>> {
    return this.core.validateApiExecutionPayloadEnvelope(envelopeBytes, executionPayloadEnvelope, seenTimestampSec);
  }

  validateGossipExecutionPayloadBid(
    bidBytes: Uint8Array,
    fork: ForkName,
    seenTimestampSec: number
  ): Promise<GossipValidationResult<{proposerIndex: ValidatorIndex}>> {
    return this.core.validateGossipExecutionPayloadBid(bidBytes, fork, seenTimestampSec);
  }

  validateApiExecutionPayloadBid(
    bidBytes: Uint8Array,
    signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid
  ): Promise<GossipValidationResult<void>> {
    return this.core.validateApiExecutionPayloadBid(bidBytes, signedExecutionPayloadBid);
  }

  validateGossipProposerPreferences(preferencesBytes: Uint8Array): Promise<GossipValidationResult<void>> {
    return this.core.validateGossipProposerPreferences(preferencesBytes);
  }

  validateGossipAttesterSlashing(
    attesterSlashingBytes: Uint8Array,
    fork: ForkName
  ): Promise<GossipValidationResult<void>> {
    return this.core.validateGossipAttesterSlashing(attesterSlashingBytes, fork);
  }

  validateApiAttesterSlashing(attesterSlashing: AttesterSlashing, fork: ForkName): Promise<void> {
    return this.core.validateApiAttesterSlashing(attesterSlashing, fork);
  }

  validateGossipProposerSlashing(proposerSlashingBytes: Uint8Array): Promise<GossipValidationResult<void>> {
    return this.core.validateGossipProposerSlashing(proposerSlashingBytes);
  }

  validateApiProposerSlashing(proposerSlashing: phase0.ProposerSlashing): Promise<void> {
    return this.core.validateApiProposerSlashing(proposerSlashing);
  }

  validateGossipVoluntaryExit(voluntaryExitBytes: Uint8Array): Promise<GossipValidationResult<void>> {
    return this.core.validateGossipVoluntaryExit(voluntaryExitBytes);
  }

  validateApiVoluntaryExit(
    voluntaryExit: phase0.SignedVoluntaryExit
  ): Promise<ApiVoluntaryExitResult & {inserted?: boolean}> {
    return this.core.validateApiVoluntaryExit(voluntaryExit);
  }

  drainDeferredVoluntaryExits(): Promise<phase0.SignedVoluntaryExit[]> {
    return this.core.drainDeferredVoluntaryExits();
  }

  insertVoluntaryExit(exit: phase0.SignedVoluntaryExit): Promise<void> {
    return this.core.insertVoluntaryExit(exit);
  }

  validateGossipBlsToExecutionChange(blsToExecutionChangeBytes: Uint8Array): Promise<GossipValidationResult<void>> {
    return this.core.validateGossipBlsToExecutionChange(blsToExecutionChangeBytes);
  }

  validateApiBlsToExecutionChange(
    blsToExecutionChange: capella.SignedBLSToExecutionChange,
    preCapella: boolean
  ): Promise<void> {
    return this.core.validateApiBlsToExecutionChange(blsToExecutionChange, preCapella);
  }

  getPoolProposerPreferences(slot?: Slot, dependentRoot?: RootHex): Promise<gloas.SignedProposerPreferences[]> {
    return this.core.getPoolProposerPreferences(slot, dependentRoot);
  }

  getPoolAttesterSlashings(): Promise<AttesterSlashing[]> {
    return this.core.getPoolAttesterSlashings();
  }

  getPoolProposerSlashings(): Promise<phase0.ProposerSlashing[]> {
    return this.core.getPoolProposerSlashings();
  }

  getPoolVoluntaryExits(): Promise<phase0.SignedVoluntaryExit[]> {
    return this.core.getPoolVoluntaryExits();
  }

  getPoolBlsToExecutionChanges(): Promise<capella.SignedBLSToExecutionChange[]> {
    return this.core.getPoolBlsToExecutionChanges();
  }

  addAttestationToPool(
    committeeIndex: CommitteeIndex,
    attestation: SingleAttestation,
    attDataRootHex: RootHex,
    validatorCommitteeIndex: number,
    committeeSize: number,
    priority?: boolean
  ): Promise<InsertOutcome> {
    return this.core.addAttestationToPool(
      committeeIndex,
      attestation,
      attDataRootHex,
      validatorCommitteeIndex,
      committeeSize,
      priority
    );
  }

  getAttestationAggregate(
    slot: Slot,
    dataRootHex: RootHex,
    committeeIndex: CommitteeIndex
  ): Promise<Attestation | null> {
    return this.core.getAttestationAggregate(slot, dataRootHex, committeeIndex);
  }

  getPoolAggregatedAttestations(bySlot?: Slot): Promise<Attestation[]> {
    return this.core.getPoolAggregatedAttestations(bySlot);
  }

  getSyncCommitteeContribution(
    subnet: SubcommitteeIndex,
    slot: Slot,
    prevBlockRoot: Root
  ): Promise<altair.SyncCommitteeContribution | null> {
    return this.core.getSyncCommitteeContribution(subnet, slot, prevBlockRoot);
  }

  getPoolPayloadAttestations(slot?: Slot): Promise<gloas.PayloadAttestation[]> {
    return this.core.getPoolPayloadAttestations(slot);
  }

  getProposerFeeRecipient(proposerIndex: ValidatorIndex): Promise<string | undefined> {
    return this.core.getProposerFeeRecipient(proposerIndex);
  }

  trackAttachedValidators(epoch: Epoch, validatorIndices: ValidatorIndex[]): Promise<boolean> {
    return this.core.trackAttachedValidators(epoch, validatorIndices);
  }

  updateProposerPreparation(epoch: Epoch, proposers: ProposerPreparationData[]): Promise<boolean> {
    return this.core.updateProposerPreparation(epoch, proposers);
  }

  getProposerCacheValidatorIndices(): Promise<ValidatorIndex[]> {
    return this.core.getProposerCacheValidatorIndices();
  }

  getCheckpointEffectiveBalances(checkpoint: CheckpointWithHex): Promise<EffectiveBalanceIncrements | undefined> {
    return this.core.getCheckpointEffectiveBalances(checkpoint);
  }

  pruneOnFinalized(): Promise<void> {
    return this.core.pruneOnFinalized();
  }

  validatorSeenAtEpoch(index: ValidatorIndex, epoch: Epoch): Promise<boolean> {
    return this.core.validatorSeenAtEpoch(index, epoch);
  }

  recomputeForkChoiceHead(caller: ForkchoiceCaller): ProtoBlock {
    return this.core.recomputeForkChoiceHead(caller);
  }

  getConflictingBlockRoots(slot: Slot, proposerIndex: ValidatorIndex, root: RootHex): Promise<RootHex[]> {
    return this.core.getConflictingBlockRoots(slot, proposerIndex, root);
  }

  verifyAndObserveBlockProposer(bytes: Uint8Array, block: SignedBeaconBlock, root: RootHex): Promise<void> {
    return this.core.verifyAndObserveBlockProposer(bytes, block, root);
  }

  verifyEnvelopeForPublish(
    bytes: Uint8Array,
    envelope: gloas.SignedExecutionPayloadEnvelope,
    blockRootHex: RootHex
  ): Promise<void> {
    return this.core.verifyEnvelopeForPublish(bytes, envelope, blockRootHex);
  }

  isBlockProposerSeen(slot: Slot, proposerIndex: ValidatorIndex): Promise<boolean> {
    return this.core.isBlockProposerSeen(slot, proposerIndex);
  }

  async validateApiBlock(blockInput: IBlockInput, opts: VerifyBlocksOpts): Promise<void> {
    const block = blockInput.getBlock();
    let bytes = this.serializedCache.get(block);
    if (bytes === undefined) {
      bytes = this.config.getForkTypes(block.message.slot).SignedBeaconBlock.serialize(block);
      this.serializedCache.set(block, bytes);
    }
    const res = await this.core.validateApiBlock(computeSignedBlockRoot(blockInput.forkName, block), bytes, opts);
    if (res.err !== null) throw blockErrorFromFailure(res.err, [blockInput]);
  }

  async verifyBlocks(
    blockInputs: IBlockInput[],
    opts: VerifyBlocksOpts
  ): Promise<{segmentExecStatus: SegmentExecStatus; verifyStateTime: number; verifySignaturesTime: number}> {
    if (blockInputs.length === 1 && blockInputs[0].getBlockSource().source === BlockInputSource.gossip) {
      const blockInput = blockInputs[0];
      const result = await this.core.verifyGossipBlock(
        computeSignedBlockRoot(blockInput.forkName, blockInput.getBlock()),
        opts
      );
      if (result.err !== null) {
        if ("code" in result.err) throw new BlockError(blockInput.getBlock(), result.err);
        throw blockErrorFromFailure(result.err, [blockInput]);
      }
      return result.result;
    }

    const blocks = blockInputs.map((blockInput) => {
      const block = blockInput.getBlock();
      let bytes = this.serializedCache.get(block);
      if (bytes === undefined) {
        bytes = this.config.getForkTypes(blockInput.slot).SignedBeaconBlock.serialize(block);
        this.serializedCache.set(block, bytes);
      }
      return {signedBlockRoot: computeSignedBlockRoot(blockInput.forkName, block), blockBytes: bytes};
    });
    const res = await this.core.verifyBlocks(blocks, opts);
    if (res.err !== null) throw blockErrorFromFailure(res.err, blockInputs);
    return res.result;
  }

  async importBlock(
    blockInput: IBlockInput,
    dataAvailabilityStatus: DataAvailabilityStatus,
    opts: ImportBlockOpts
  ): Promise<ImportBlockResult> {
    const res = await this.core.importBlock(
      computeSignedBlockRoot(blockInput.forkName, blockInput.getBlock()),
      dataAvailabilityStatus,
      opts
    );
    if (res.err !== null) throw blockErrorFromFailure(res.err, [blockInput]);
    return res.result;
  }

  discardVerifiedBlocks(signedBlockRoots: SignedBlockRoot[]): void {
    this.core.discardVerifiedBlocks(signedBlockRoots);
  }

  onSlot(slot: Slot): void {
    this.core.onSlot(slot);
  }

  onEpoch(epoch: Epoch): void {
    this.core.onEpoch(epoch);
  }

  updateTime(currentSlot: Slot): void {
    this.core.updateTime(currentSlot);
  }

  async importExecutionPayload(
    payloadInput: PayloadEnvelopeInput,
    envelopeBytes: Uint8Array,
    dataAvailabilityStatus: DataAvailabilityStatus,
    opts: ImportExecutionPayloadOpts
  ): Promise<{executionOptimistic: boolean}> {
    const res = await this.core.importExecutionPayload(envelopeBytes, dataAvailabilityStatus, opts);
    if (res.err !== null) {
      const error = new PayloadImportError(payloadInput, res.err.type, res.err.message);
      error.stack = res.err.stack;
      throw error;
    }
    return res.result;
  }

  migrateCanonicalBlocks(): Promise<Slot[]> {
    return this.core.migrateCanonicalBlocks();
  }

  migrateExecutionPayloadEnvelopes(): Promise<Slot[]> {
    return this.core.migrateExecutionPayloadEnvelopes();
  }

  deleteNonCanonicalExecutionPayloadEnvelopes(roots: Uint8Array[]): Promise<void> {
    return this.core.deleteNonCanonicalExecutionPayloadEnvelopes(roots);
  }

  persistOrphanedBlocks(blocks: FinalizedProtoSummary[], directory?: string): Promise<void> {
    return this.core.persistOrphanedBlocks(blocks, directory);
  }

  deleteNonCanonicalBlocks(roots: Uint8Array[]): Promise<void> {
    return this.core.deleteNonCanonicalBlocks(roots);
  }

  completeFinalization(finalized: CheckpointWithHex): Promise<number> {
    return this.core.completeFinalization(finalized);
  }

  getEarliestArchivedBlockSlot(): Promise<Slot | null> {
    return this.core.getEarliestArchivedBlockSlot();
  }

  persistFinalizedStateToDisk(): Promise<void> {
    return this.core.persistFinalizedStateToDisk();
  }

  pruneHistory(finalizedEpoch: Epoch, currentEpoch: Epoch): Promise<Slot> {
    return this.core.pruneHistory(finalizedEpoch, currentEpoch);
  }

  loadOpPoolFromDisk(): Promise<void> {
    return this.core.loadOpPoolFromDisk();
  }

  persistOpPoolToDisk(): Promise<void> {
    return this.core.persistOpPoolToDisk();
  }
}
