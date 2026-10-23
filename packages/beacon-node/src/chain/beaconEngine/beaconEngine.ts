import {CompactMultiProof} from "@chainsafe/persistent-merkle-tree";
import {routes} from "@lodestar/api";
import {BeaconConfig} from "@lodestar/config";
import {CheckpointWithHex, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {ForkName, ForkPostBellatrix, ForkPreGloas, ForkSeq, isForkPostDeneb} from "@lodestar/params";
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
  SignedBlindedBeaconBlock,
  SingleAttestation,
  Slot,
  SubcommitteeIndex,
  SubnetID,
  ValidatorIndex,
  altair,
  bellatrix,
  capella,
  deneb,
  electra,
  fulu,
  gloas,
  phase0,
  rewards,
  ssz,
  sszTypesFor,
} from "@lodestar/types";
import {Logger, fromHex, toRootHex} from "@lodestar/utils";
import {ApiError, ValidationError} from "../../api/impl/errors.js";
import {rootHexRegex} from "../../execution/engine/utils.js";
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
import {ChainView} from "../chainView/chainView.js";
import {ChainViewBlock, ChainViewState} from "../chainView/interface.js";
import {ChainEvent, ChainEventEmitter} from "../emitter.js";
import {BlockError} from "../errors/index.js";
import {ForkchoiceCaller} from "../forkChoice/index.js";
import {InsertOutcome} from "../opPools/types.js";
import {RegenRequest} from "../regen/index.js";
import {ApiAttestation, AttestationValidationResult, GossipAttestation} from "../validation/attestation.js";
import {ApiVoluntaryExitResult} from "../validation/voluntaryExit.js";
import {ValidatorMonitorAttestation, ValidatorMonitorBlock} from "../validatorMonitor.js";
import type {BeaconEngineCore} from "./beaconEngineCore.js";
import {fromChainViewBlockBytes} from "./chainView.js";
import {BeaconEngineEvent, FastConfirmation, HeadUpdate} from "./events.js";
import {GossipBlockResult} from "./gossipValidation/block.js";
import {GossipValidationResult} from "./gossipValidationResult.js";
import {AnchorSummary, EngineBootstrap} from "./initialization.js";
import {
  ApiBlockId,
  ApiStateId,
  ApiStateResult,
  ApiStateResultWithFork,
  BlockRootResponse,
  FinalizedProtoSummary,
  HeadExecutionStateInfo,
  HeadParentPayload,
  IBeaconEngine,
  ImportBlockResult,
  ImportExecutionPayloadOpts,
  PayloadAttestationBlock,
  PrepareNextSlotOpts,
  PrepareNextSlotResponse,
  ProduceBlockRequest,
  ProduceBlockResponse,
  ProduceBlockV4Request,
  ProduceBlockV4Response,
  ProductionResponse,
  SerializedLightClientData,
  SubmitBlindedBlockResponse,
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
  beaconEngineWorker?: boolean;
  logger?: Logger;
};

export class BeaconEngine implements IBeaconEngine {
  readonly config: BeaconConfig;
  private readonly core: BeaconEngineCore;
  private readonly emitter: ChainEventEmitter;
  private readonly clock: IClock;
  private readonly serializedCache: SerializedCache;
  private readonly beaconEngineWorker: boolean;
  private readonly logger?: Logger;
  private closed = false;
  /** Set by initializeFromAnchor() */
  chainView!: ChainView;

  constructor({
    core,
    config,
    emitter,
    clock,
    serializedCache,
    beaconEngineWorker = false,
    logger,
  }: BeaconEngineModules) {
    this.core = core;
    this.config = config;
    this.emitter = emitter;
    this.clock = clock;
    this.serializedCache = serializedCache;
    this.beaconEngineWorker = beaconEngineWorker;
    this.logger = logger;
    // TODO - beacon engine: in worker mode, post core notifications to a main-thread event bus.
    this.core.emitter.on(BeaconEngineEvent.earliestAvailableSlotUpdated, this.onEarliestAvailableSlotUpdated);
    this.core.emitter.on(BeaconEngineEvent.fatalError, this.onFatalError);
    this.core.emitter.on(BeaconEngineEvent.builderRegistered, this.onBuilderRegistered);
    this.core.emitter.on(BeaconEngineEvent.proposerSlashingProduced, this.onProposerSlashingProduced);
    this.core.emitter.on(BeaconEngineEvent.fastConfirmation, this.onFastConfirmation);
    this.core.emitter.on(BeaconEngineEvent.lightClientOptimisticUpdate, this.onLightClientOptimisticUpdate);
    this.core.emitter.on(BeaconEngineEvent.lightClientFinalityUpdate, this.onLightClientFinalityUpdate);
  }

  async close(): Promise<void> {
    this.closed = true;
    try {
      await this.core.close();
    } finally {
      this.core.emitter.off(BeaconEngineEvent.earliestAvailableSlotUpdated, this.onEarliestAvailableSlotUpdated);
      this.core.emitter.off(BeaconEngineEvent.fatalError, this.onFatalError);
      this.core.emitter.off(BeaconEngineEvent.builderRegistered, this.onBuilderRegistered);
      this.core.emitter.off(BeaconEngineEvent.proposerSlashingProduced, this.onProposerSlashingProduced);
      this.core.emitter.off(BeaconEngineEvent.fastConfirmation, this.onFastConfirmation);
      this.core.emitter.off(BeaconEngineEvent.lightClientOptimisticUpdate, this.onLightClientOptimisticUpdate);
      this.core.emitter.off(BeaconEngineEvent.lightClientFinalityUpdate, this.onLightClientFinalityUpdate);
    }
  }

  private readonly onHeadUpdated = async (
    previousHead?: Pick<ChainViewBlock, "blockRoot" | "payloadStatus">
  ): Promise<void> => {
    if (this.closed) return;
    const snapshot = await this.core.getHeadSnapshot(
      previousHead ? {blockRoot: fromHex(previousHead.blockRoot), payloadStatus: previousHead.payloadStatus} : undefined
    );
    if (this.closed) return;
    const head = fromChainViewBlockBytes(snapshot.head);
    this.updateChainView([head], {
      head,
      justified: {...snapshot.justified, rootHex: toRootHex(snapshot.justified.root)},
      finalized: {...snapshot.finalized, rootHex: toRootHex(snapshot.finalized.root)},
    });
    if (snapshot.headUpdate) this.emitHeadUpdate(snapshot.headUpdate);
  };

  private readonly onNewFinalizedCheckpoint = async (): Promise<void> => {
    if (this.closed) return;
    try {
      const snapshot = await this.core.getFinalizedCheckpointSnapshot();
      if (this.closed) return;
      // Core uses byte roots for transport; archival consumers expect root hexes.
      const toSummary = ({slot, blockRoot, payloadStatus}: FinalizedProtoSummary<Root>): FinalizedProtoSummary => ({
        slot,
        blockRoot: toRootHex(blockRoot),
        payloadStatus,
      });
      const checkpointSnapshot = {
        ...snapshot,
        rootHex: toRootHex(snapshot.root),
        blockSnapshot: {
          canonical: snapshot.blockSnapshot.canonical.map(toSummary),
          nonCanonical: snapshot.blockSnapshot.nonCanonical.map(toSummary),
        },
      };
      // Finalization consumers read ChainView, so apply the checkpoint before emitting.
      if (this.chainView.applyFinalizedCheckpoint(checkpointSnapshot)) this.emitter.emit(ChainEvent.updateStatus);
      this.emitter.emit(ChainEvent.forkChoiceFinalized, checkpointSnapshot);
    } catch (e) {
      this.logger?.error("Error pulling finalized checkpoint", {}, e as Error);
    }
  };

  private updateChainView(blocks: ChainViewBlock[], state?: ChainViewState): void {
    const {stateUpdated, justified} = this.chainView.addBlocks(blocks, state);
    if (justified) this.emitter.emit(ChainEvent.forkChoiceJustified, justified);
    if (stateUpdated) this.emitter.emit(ChainEvent.updateStatus);
  }

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

  private readonly emitHeadUpdate = (update: HeadUpdate<Root>): void => {
    const {slot, payloadStatus, headRootChanged, epochTransition, executionOptimistic} = update;
    const blockRoot = toRootHex(update.blockRoot);
    try {
      const stateRoot = toRootHex(update.stateRoot);
      const previousDutyDependentRoot = toRootHex(update.previousDutyDependentRoot);
      const currentDutyDependentRoot = toRootHex(update.currentDutyDependentRoot);
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
    } catch (e) {
      this.logger?.debug("Error emitting head update", {slot, root: blockRoot, headRootChanged}, e as Error);
    }
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

  prepareAnchorState(stateBytes: Uint8Array): Promise<AnchorSummary> {
    return this.core.prepareAnchorState(stateBytes);
  }

  persistAnchorState(): Promise<void> {
    return this.core.persistAnchorState();
  }

  async initializeFromAnchor(): Promise<EngineBootstrap> {
    const {chainViewSnapshot, ...bootstrap} = await this.core.initializeFromAnchor();
    this.chainView = new ChainView(chainViewSnapshot, this.logger);
    return bootstrap;
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
    return this.core.validateGossipLightClientOptimisticUpdateBytes(bytes, fork);
  }

  validateGossipLightClientFinalityUpdate(bytes: Uint8Array, fork: ForkName): Promise<GossipValidationResult<void>> {
    return this.core.validateGossipLightClientFinalityUpdateBytes(bytes, fork);
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

  async pauseFastConfirmation(): Promise<void> {
    return this.core.pauseFastConfirmation();
  }

  async resumeFastConfirmation(): Promise<void> {
    return this.core.resumeFastConfirmation();
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

  async produceBlock(request: ProduceBlockRequest): Promise<ProduceBlockResponse> {
    const response = await this.core.produceBlock(request);
    if (response.headUpdate) await this.onHeadUpdated();
    return response;
  }

  async produceBlockV4(request: ProduceBlockV4Request): Promise<ProduceBlockV4Response> {
    const response = await this.core.produceBlockV4(request);
    if (response.headUpdate) await this.onHeadUpdated();
    return response;
  }

  registerAuthenticatedBuilder(url: string): Promise<void> {
    return this.core.registerAuthenticatedBuilder(url);
  }

  registerValidator(
    epoch: Epoch,
    registrationsBytes: Uint8Array,
    registrations: bellatrix.SignedValidatorRegistrationV1[]
  ): Promise<void> {
    return this.beaconEngineWorker
      ? this.core.registerValidatorBytes(epoch, registrationsBytes)
      : this.core.registerValidator(epoch, registrations);
  }

  async submitBlindedBlock(
    signedBlindedBlockBytes: Uint8Array,
    signedBlindedBlock: SignedBlindedBeaconBlock,
    fork: ForkPostBellatrix & ForkPreGloas
  ): Promise<SubmitBlindedBlockResponse> {
    if (!this.beaconEngineWorker) {
      return {
        signedBlockContents: await this.core.submitBlindedBlock({
          data: signedBlindedBlock,
          bytes: signedBlindedBlockBytes,
        }),
      };
    }

    const contentsBytes = await this.core.submitBlindedBlockBytes(signedBlindedBlockBytes, fork);
    const signedBlockContents = isForkPostDeneb(fork)
      ? sszTypesFor(fork).SignedBlockContents.deserialize(contentsBytes)
      : {signedBlock: sszTypesFor(fork).SignedBeaconBlock.deserialize(contentsBytes)};
    return {signedBlockContents, contentsBytes};
  }

  submitBlindedBlockNoResponse(
    signedBlindedBlockBytes: Uint8Array,
    signedBlindedBlock: SignedBlindedBeaconBlock,
    fork: ForkPostBellatrix & ForkPreGloas
  ): Promise<void> {
    return this.beaconEngineWorker
      ? this.core.submitBlindedBlockNoResponseBytes(signedBlindedBlockBytes, fork)
      : this.core.submitBlindedBlockNoResponse({data: signedBlindedBlock, bytes: signedBlindedBlockBytes});
  }

  async prepareForNextSlot(clockSlot: Slot, opts: PrepareNextSlotOpts): Promise<PrepareNextSlotResponse> {
    const previousHead = this.chainView.getHead();
    const response = await this.core.prepareForNextSlot(clockSlot, opts);
    if (response.headUpdate) await this.onHeadUpdated(previousHead);
    return response;
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

  getHeadExecutionStateInfo(): Promise<HeadExecutionStateInfo> {
    return this.core.getHeadExecutionStateInfo();
  }

  async isHeadOptimistic(): Promise<boolean> {
    return this.core.isHeadOptimistic();
  }

  /** Source: unstable@9cb14e3381 api/impl/beacon/blocks/utils.ts#resolveBlockId. */
  async getBlockRoot(blockId: routes.beacon.BlockId): Promise<BlockRootResponse> {
    const normalized = String(blockId).toLowerCase();
    let id: ApiBlockId;
    if (normalized === "head" || normalized === "genesis" || normalized === "finalized" || normalized === "justified") {
      id = normalized;
    } else if (normalized.startsWith("0x")) {
      if (!rootHexRegex.test(normalized)) {
        throw new ValidationError(`Invalid block id '${normalized}'`, "blockId");
      }
      id = fromHex(normalized);
    } else {
      id = typeof blockId === "number" ? blockId : parseInt(normalized, 10);
      if (Number.isNaN(id)) {
        throw new ValidationError(`Invalid block id '${normalized}'`, "blockId");
      }
    }
    const res = await this.core.getBlockRoot(id);
    if (!res) throw new ApiError(404, `Block not found for id '${blockId}'`);
    return res;
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

  async getCanonicalBlockAtSlot(
    slot: Slot
  ): Promise<{block: SignedBeaconBlock; executionOptimistic: boolean; finalized: boolean} | null> {
    const res = await this.core.getCanonicalBlockAtSlot(slot);
    return (
      res && {
        block: this.config.getForkTypes(res.slot).SignedBeaconBlock.deserialize(res.block, {reuseBytes: false}),
        executionOptimistic: res.executionOptimistic,
        finalized: res.finalized,
      }
    );
  }

  async getBlockByRoot(
    root: Root
  ): Promise<{block: SignedBeaconBlock; executionOptimistic: boolean; finalized: boolean} | null> {
    const res = await this.core.getBlockByRoot(root);
    return (
      res && {
        block: this.config.getForkTypes(res.slot).SignedBeaconBlock.deserialize(res.block, {reuseBytes: false}),
        executionOptimistic: res.executionOptimistic,
        finalized: res.finalized,
      }
    );
  }

  async getBlockHeaders(opts: {slot?: Slot; parentRoot?: Root}): Promise<{
    data: routes.beacon.BlockHeaderResponse[];
    meta: {executionOptimistic: boolean; finalized: boolean};
  }> {
    const res = await this.core.getBlockHeaders(opts);
    return {
      data: routes.beacon.block.BlockHeadersResponseType.deserialize(res.data, {reuseBytes: false}),
      meta: res.meta,
    };
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

  produceAttestationData(
    slot: Slot,
    committeeIndex?: CommitteeIndex
  ): Promise<ProductionResponse<phase0.AttestationData>> {
    return this.core.produceAttestationData(slot, committeeIndex);
  }

  async getPayloadAttestationBlock(slot: Slot): Promise<PayloadAttestationBlock | null> {
    return this.core.getPayloadAttestationBlock(slot);
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
    return this.beaconEngineWorker
      ? this.core.validateGossipBlockBytes(
          computeSignedBlockRoot(fork, signedBlock),
          blockBytes,
          fork,
          seenTimestampSec
        )
      : this.core.validateGossipBlock({data: signedBlock, bytes: blockBytes}, fork, seenTimestampSec);
  }

  validateGossipSyncCommittee(
    syncCommitteeBytes: Uint8Array,
    syncCommittee: altair.SyncCommitteeMessage,
    subnet: SubnetID
  ): Promise<GossipValidationResult<void>> {
    return this.beaconEngineWorker
      ? this.core.validateGossipSyncCommitteeBytes(syncCommitteeBytes, subnet)
      : this.core.validateGossipSyncCommittee(syncCommittee, subnet);
  }

  validateApiSyncCommittee(
    syncCommitteeBytes: Uint8Array,
    syncCommittee: altair.SyncCommitteeMessage
  ): Promise<GossipValidationResult<{subnets: number[]}>> {
    return this.beaconEngineWorker
      ? this.core.validateApiSyncCommitteeBytes(syncCommitteeBytes)
      : this.core.validateApiSyncCommittee(syncCommittee);
  }

  validateSyncCommitteeGossipContributionAndProof(
    contributionBytes: Uint8Array,
    signedContributionAndProof: altair.SignedContributionAndProof,
    skipValidationKnownParticipants?: boolean
  ): Promise<GossipValidationResult<{syncCommitteeParticipantIndices: ValidatorIndex[]}>> {
    return this.beaconEngineWorker
      ? this.core.validateSyncCommitteeGossipContributionAndProofBytes(
          contributionBytes,
          skipValidationKnownParticipants
        )
      : this.core.validateSyncCommitteeGossipContributionAndProof(
          signedContributionAndProof,
          skipValidationKnownParticipants
        );
  }

  validateApiSyncCommitteeContributionAndProof(
    contributionBytes: Uint8Array,
    signedContributionAndProof: altair.SignedContributionAndProof
  ): Promise<GossipValidationResult<void>> {
    return this.beaconEngineWorker
      ? this.core.validateApiSyncCommitteeContributionAndProofBytes(contributionBytes)
      : this.core.validateApiSyncCommitteeContributionAndProof(signedContributionAndProof);
  }

  validateGossipBlobSidecar(
    blobBytes: Uint8Array,
    blobSidecar: deneb.BlobSidecar,
    fork: ForkName,
    subnet: SubnetID
  ): Promise<GossipValidationResult<void>> {
    return this.beaconEngineWorker
      ? this.core.validateGossipBlobSidecarBytes(blobBytes, fork, subnet)
      : this.core.validateGossipBlobSidecar(blobSidecar, fork, subnet);
  }

  validateGossipFuluDataColumnSidecar(
    dataColumnBytes: Uint8Array,
    dataColumnSidecar: fulu.DataColumnSidecar,
    gossipSubnet: SubnetID
  ): Promise<GossipValidationResult<void>> {
    return this.beaconEngineWorker
      ? this.core.validateGossipFuluDataColumnSidecarBytes(dataColumnBytes, gossipSubnet)
      : this.core.validateGossipFuluDataColumnSidecar(dataColumnSidecar, gossipSubnet);
  }

  validateGossipGloasDataColumnSidecar(
    dataColumnBytes: Uint8Array,
    dataColumnSidecar: gloas.DataColumnSidecar,
    gossipSubnet: SubnetID
  ): Promise<GossipValidationResult<void>> {
    return this.beaconEngineWorker
      ? this.core.validateGossipGloasDataColumnSidecarBytes(dataColumnBytes, gossipSubnet)
      : this.core.validateGossipGloasDataColumnSidecar(dataColumnSidecar, gossipSubnet);
  }

  validateGossipPayloadAttestationMessage(
    payloadAttestationBytes: Uint8Array,
    payloadAttestationMessage: gloas.PayloadAttestationMessage
  ): Promise<GossipValidationResult<void>> {
    return this.beaconEngineWorker
      ? this.core.validateGossipPayloadAttestationMessageBytes(payloadAttestationBytes)
      : this.core.validateGossipPayloadAttestationMessage(payloadAttestationMessage);
  }

  validateApiPayloadAttestationMessage(
    payloadAttestationBytes: Uint8Array,
    payloadAttestationMessage: gloas.PayloadAttestationMessage
  ): Promise<GossipValidationResult<void>> {
    return this.beaconEngineWorker
      ? this.core.validateApiPayloadAttestationMessageBytes(payloadAttestationBytes)
      : this.core.validateApiPayloadAttestationMessage(payloadAttestationMessage);
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
    signedAggregateAndProof: SignedAggregateAndProof,
    fork: ForkName,
    seenTimestampSec: number
  ): Promise<GossipValidationResult<{indexedAttestation: IndexedAttestation}>> {
    return this.beaconEngineWorker
      ? this.core.validateGossipAggregateAndProofBytes(aggregateBytes, fork, seenTimestampSec)
      : this.core.validateGossipAggregateAndProof(
          {data: signedAggregateAndProof, bytes: aggregateBytes},
          fork,
          seenTimestampSec
        );
  }

  validateApiAggregateAndProof(
    aggregateBytes: Uint8Array,
    fork: ForkName,
    signedAggregateAndProof: SignedAggregateAndProof
  ): Promise<GossipValidationResult<{indexedAttestation: IndexedAttestation}>> {
    return this.beaconEngineWorker
      ? this.core.validateApiAggregateAndProofBytes(aggregateBytes, fork)
      : this.core.validateApiAggregateAndProof(fork, signedAggregateAndProof);
  }

  validateGossipExecutionPayloadEnvelope(
    envelopeBytes: Uint8Array,
    executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope,
    source: SourceMeta
  ): Promise<GossipValidationResult<void>> {
    return this.beaconEngineWorker
      ? this.core.validateGossipExecutionPayloadEnvelopeBytes(envelopeBytes, source)
      : this.core.validateGossipExecutionPayloadEnvelope(executionPayloadEnvelope, source);
  }

  validateApiExecutionPayloadEnvelope(
    envelopeBytes: Uint8Array,
    executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope,
    seenTimestampSec: number
  ): Promise<GossipValidationResult<void>> {
    return this.beaconEngineWorker
      ? this.core.validateApiExecutionPayloadEnvelopeBytes(envelopeBytes, seenTimestampSec)
      : this.core.validateApiExecutionPayloadEnvelope(executionPayloadEnvelope, seenTimestampSec);
  }

  validateGossipExecutionPayloadBid(
    bidBytes: Uint8Array,
    signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid,
    fork: ForkName,
    seenTimestampSec: number
  ): Promise<GossipValidationResult<{proposerIndex: ValidatorIndex}>> {
    return this.beaconEngineWorker
      ? this.core.validateGossipExecutionPayloadBidBytes(bidBytes, fork, seenTimestampSec)
      : this.core.validateGossipExecutionPayloadBid(signedExecutionPayloadBid, seenTimestampSec);
  }

  validateApiExecutionPayloadBid(
    bidBytes: Uint8Array,
    signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid
  ): Promise<GossipValidationResult<void>> {
    return this.beaconEngineWorker
      ? this.core.validateApiExecutionPayloadBidBytes(bidBytes)
      : this.core.validateApiExecutionPayloadBid(signedExecutionPayloadBid);
  }

  validateGossipProposerPreferences(
    preferencesBytes: Uint8Array,
    signedProposerPreferences: gloas.SignedProposerPreferences
  ): Promise<GossipValidationResult<void>> {
    return this.beaconEngineWorker
      ? this.core.validateGossipProposerPreferencesBytes(preferencesBytes)
      : this.core.validateGossipProposerPreferences(signedProposerPreferences);
  }

  validateGossipAttesterSlashing(
    attesterSlashingBytes: Uint8Array,
    attesterSlashing: AttesterSlashing,
    fork: ForkName
  ): Promise<GossipValidationResult<void>> {
    return this.beaconEngineWorker
      ? this.core.validateGossipAttesterSlashingBytes(attesterSlashingBytes, fork)
      : this.core.validateGossipAttesterSlashing(attesterSlashing, fork);
  }

  validateApiAttesterSlashing(attesterSlashing: AttesterSlashing, fork: ForkName): Promise<void> {
    return this.core.validateApiAttesterSlashing(attesterSlashing, fork);
  }

  validateGossipProposerSlashing(
    proposerSlashingBytes: Uint8Array,
    proposerSlashing: phase0.ProposerSlashing
  ): Promise<GossipValidationResult<void>> {
    return this.beaconEngineWorker
      ? this.core.validateGossipProposerSlashingBytes(proposerSlashingBytes)
      : this.core.validateGossipProposerSlashing(proposerSlashing);
  }

  validateApiProposerSlashing(proposerSlashing: phase0.ProposerSlashing): Promise<void> {
    return this.core.validateApiProposerSlashing(proposerSlashing);
  }

  validateGossipVoluntaryExit(
    voluntaryExitBytes: Uint8Array,
    voluntaryExit: phase0.SignedVoluntaryExit
  ): Promise<GossipValidationResult<void>> {
    return this.beaconEngineWorker
      ? this.core.validateGossipVoluntaryExitBytes(voluntaryExitBytes)
      : this.core.validateGossipVoluntaryExit(voluntaryExit);
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

  validateGossipBlsToExecutionChange(
    blsToExecutionChangeBytes: Uint8Array,
    blsToExecutionChange: capella.SignedBLSToExecutionChange
  ): Promise<GossipValidationResult<void>> {
    return this.beaconEngineWorker
      ? this.core.validateGossipBlsToExecutionChangeBytes(blsToExecutionChangeBytes)
      : this.core.validateGossipBlsToExecutionChange(blsToExecutionChange);
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

  async produceSyncCommitteeContribution(
    subnet: SubcommitteeIndex,
    slot: Slot,
    blockRoot: Root
  ): Promise<ProductionResponse<altair.SyncCommitteeContribution | null>> {
    const result = await this.core.produceSyncCommitteeContribution(subnet, slot, blockRoot);
    return result.ok
      ? {ok: true, data: result.data === null ? null : ssz.altair.SyncCommitteeContribution.deserialize(result.data)}
      : result;
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

  regenCanAcceptWork(): boolean {
    if (this.beaconEngineWorker) {
      // TODO - beacon engine: temporarily disable regen gossip backpressure to avoid synchronous
      // engine calls across the worker boundary.
      // for a worker BeaconEngine, can do a shared Uint8Array for this
      return true;
    }
    return this.core.regen.canAcceptWork();
  }

  blsThreadPoolCanAcceptWork(): boolean {
    if (this.beaconEngineWorker) {
      // TODO - beacon engine: temporarily disable BLS gossip backpressure to avoid synchronous
      // engine calls across the worker boundary.
      // for a worker BeaconEngine, can do a shared Uint8Array for this
      return true;
    }
    return this.core.bls.canAcceptWork();
  }

  validatorSeenAtEpoch(index: ValidatorIndex, epoch: Epoch): Promise<boolean> {
    return this.core.validatorSeenAtEpoch(index, epoch);
  }

  async recomputeForkChoiceHead(caller: ForkchoiceCaller): Promise<void> {
    const previousHead = this.chainView.getHead();
    const {headUpdate} = await this.core.recomputeForkChoiceHead(caller);
    if (headUpdate) await this.onHeadUpdated(previousHead);
  }

  getConflictingBlockRoots(slot: Slot, proposerIndex: ValidatorIndex, root: RootHex): Promise<RootHex[]> {
    return this.core.getConflictingBlockRoots(slot, proposerIndex, root);
  }

  verifyAndObserveBlockProposer(bytes: Uint8Array, block: SignedBeaconBlock, root: RootHex): Promise<void> {
    return this.beaconEngineWorker
      ? this.core.verifyAndObserveBlockProposerBytes(bytes, root)
      : this.core.verifyAndObserveBlockProposer(block, root);
  }

  verifyEnvelopeForPublish(
    bytes: Uint8Array,
    envelope: gloas.SignedExecutionPayloadEnvelope,
    blockRootHex: RootHex
  ): Promise<void> {
    return this.beaconEngineWorker
      ? this.core.verifyEnvelopeForPublishBytes(bytes, blockRootHex)
      : this.core.verifyEnvelopeForPublish(envelope, blockRootHex);
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
    const res = this.beaconEngineWorker
      ? await this.core.validateApiBlockBytes(computeSignedBlockRoot(blockInput.forkName, block), bytes, opts)
      : await this.core.validateApiBlock({data: block, bytes}, opts);
    if (res.err !== null) throw blockErrorFromFailure(res.err, [blockInput]);
  }

  async verifyBlocks(
    blockInputs: IBlockInput[],
    opts: VerifyBlocksOpts
  ): Promise<{segmentExecStatus: SegmentExecStatus; verifyStateTime: number; verifySignaturesTime: number}> {
    const getBlocksWithBytes = () =>
      blockInputs.map((blockInput) => {
        const block = blockInput.getBlock();
        let bytes = this.serializedCache.get(block);
        if (bytes === undefined) {
          bytes = this.config.getForkTypes(blockInput.slot).SignedBeaconBlock.serialize(block);
          this.serializedCache.set(block, bytes);
        }
        return {data: block, bytes};
      });

    // main-thread mode
    if (!this.beaconEngineWorker) {
      const res = await this.core.verifyBlocks(getBlocksWithBytes(), opts);
      if (res.err !== null) throw blockErrorFromFailure(res.err, blockInputs);
      return res.result;
    }

    // worker mode, gossip path
    const isGossip = blockInputs.length === 1 && blockInputs[0].getBlockSource().source === BlockInputSource.gossip;
    if (isGossip) {
      const blockInput = blockInputs[0];
      const block = blockInput.getBlock();
      const result = await this.core.verifyGossipBlockBytes(computeSignedBlockRoot(blockInput.forkName, block), opts);
      if (result.err !== null) {
        if ("code" in result.err) throw new BlockError(blockInput.getBlock(), result.err);
        throw blockErrorFromFailure(result.err, [blockInput]);
      }
      return result.result;
    }

    // other worker mode paths
    const res = await this.core.verifyBlocksBytes(
      getBlocksWithBytes().map(({data, bytes}, i) => ({
        signedBlockRoot: computeSignedBlockRoot(blockInputs[i].forkName, data),
        blockBytes: bytes,
      })),
      opts
    );
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
    const {justified, finalized, headUpdate, reorg, finalizedCheckpointChanged, executionOptimistic} = res.result;
    const block = fromChainViewBlockBytes(res.result.block);
    const newHead = fromChainViewBlockBytes(res.result.newHead);
    if (!this.closed) {
      this.updateChainView([block, newHead], {
        head: newHead,
        justified: {...justified, rootHex: toRootHex(justified.root)},
        finalized: {...finalized, rootHex: toRootHex(finalized.root)},
      });
      if (finalizedCheckpointChanged) void this.onNewFinalizedCheckpoint();
      if (headUpdate) {
        this.emitHeadUpdate(headUpdate);
      }
      if (reorg) {
        this.emitter.emit(routes.events.EventType.chainReorg, {
          ...reorg,
          newHeadBlock: toRootHex(reorg.newHeadBlock),
          oldHeadBlock: toRootHex(reorg.oldHeadBlock),
          newHeadState: toRootHex(reorg.newHeadState),
          oldHeadState: toRootHex(reorg.oldHeadState),
        });
      }
    }
    return {block, newHead, executionOptimistic};
  }

  async discardVerifiedBlocks(signedBlockRoots: SignedBlockRoot[]): Promise<void> {
    return this.core.discardVerifiedBlocks(signedBlockRoots);
  }

  async onSlot(slot: Slot): Promise<void> {
    const previousHead = this.chainView.getHead();
    const {headUpdate, finalizedCheckpointChanged} = await this.core.onSlot(slot);
    if (this.closed) return;
    if (headUpdate) await this.onHeadUpdated(previousHead);
    if (finalizedCheckpointChanged) void this.onNewFinalizedCheckpoint();
  }

  async onEpoch(epoch: Epoch): Promise<void> {
    return this.core.onEpoch(epoch);
  }

  async importExecutionPayload(
    payloadInput: PayloadEnvelopeInput,
    envelopeBytes: Uint8Array,
    dataAvailabilityStatus: DataAvailabilityStatus,
    opts: ImportExecutionPayloadOpts
  ): Promise<{executionOptimistic: boolean}> {
    const res = this.beaconEngineWorker
      ? await this.core.importExecutionPayloadBytes(envelopeBytes, dataAvailabilityStatus, opts)
      : await this.core.importExecutionPayload(
          {data: payloadInput.getPayloadEnvelope(), bytes: envelopeBytes},
          dataAvailabilityStatus,
          opts
        );
    if (res.err !== null) {
      const error = new PayloadImportError(payloadInput, res.err.type, res.err.message);
      error.stack = res.err.stack;
      throw error;
    }
    const {block, executionOptimistic} = res.result;
    if (this.closed) return {executionOptimistic};
    this.updateChainView([fromChainViewBlockBytes(block)]);

    // Source: unstable@1bf214377e chain/blocks/importExecutionPayload.ts, post-import event emission.
    const envelope = payloadInput.getPayloadEnvelope().message;
    if (this.clock.currentSlot - envelope.payload.slotNumber < EVENTSTREAM_EMIT_RECENT_EXECUTION_PAYLOAD_SLOTS) {
      this.emitter.emit(routes.events.EventType.executionPayload, {
        slot: envelope.payload.slotNumber,
        builderIndex: envelope.builderIndex,
        blockHash: toRootHex(envelope.payload.blockHash),
        blockRoot: toRootHex(envelope.beaconBlockRoot),
        executionOptimistic,
      });
    }
    return {executionOptimistic};
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

  async completeFinalization(finalized: CheckpointWithHex): Promise<number> {
    const prunedBlockCount = await this.core.completeFinalization(finalized);
    // Only drop ChainView metadata once core has archived state and pruned fork choice
    this.chainView.prune(finalized);
    return prunedBlockCount;
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
