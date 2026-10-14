import type {PubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {CompactMultiProof} from "@chainsafe/persistent-merkle-tree";
import {routes} from "@lodestar/api";
import type {ApiError} from "@lodestar/api/server";
import {BeaconConfig} from "@lodestar/config";
import {CheckpointWithHex, IForkChoice, ProtoBlock, ProtoNode} from "@lodestar/fork-choice";
import {ForkName, ForkSeq} from "@lodestar/params";
import {DataAvailabilityStatus, EffectiveBalanceIncrements} from "@lodestar/state-transition";
import {
  Attestation,
  AttesterSlashing,
  BLSSignature,
  BeaconBlock,
  BlindedBeaconBlock,
  Bytes32,
  CommitteeIndex,
  Epoch,
  IndexedAttestation,
  ProducedBlockSource,
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
import {Logger} from "@lodestar/utils";
import {IBeaconEngineDb} from "../../db/index.js";
import type {BuilderApiClientOpts} from "../../execution/builder/apiClient.js";
import {IExecutionBuilder, IExecutionEngine} from "../../execution/index.js";
import {Metrics} from "../../metrics/index.js";
import {CommitteeSubscription} from "../../network/subnets/interface.js";
import {IClock} from "../../util/clock.js";
import {SerializedCache} from "../../util/serializedCache.js";
import {ProposerPreparationData} from "../beaconProposerCache.js";
import {BlockBytes, BlockSerializedCache} from "../blocks/blockSerializedCache.js";
import {PayloadEnvelopeInputSource, SourceMeta} from "../blocks/payloadEnvelopeInput/types.js";
import {ImportBlockOpts} from "../blocks/types.js";
import {SegmentExecStatus} from "../blocks/verifyBlocksExecutionPayloads.js";
import {ChainViewSnapshot, FinalizedProtoSummary} from "../chainView/interface.js";
import {ChainEventEmitter, ReorgEventData} from "../emitter.js";
import {ForkchoiceCaller} from "../forkChoice/index.js";
import {InsertOutcome} from "../opPools/types.js";
import {BlockProcessOpts} from "../options.js";
import {ProduceResult} from "../produceBlock/produceBlockBody.js";
import {RegenRequest} from "../regen/index.js";
import {CPStateDatastore} from "../stateCache/datastore/types.js";
import {ApiAttestation, AttestationValidationResult, GossipAttestation} from "../validation/attestation.js";
import {GossipBlockValidationResult} from "../validation/block.js";
import type {ApiVoluntaryExitResult} from "../validation/voluntaryExit.js";
import {ValidatorMonitorAttestation, ValidatorMonitorBlock, ValidatorMonitorOpts} from "../validatorMonitor.js";
import {IBeaconEngineEventBus} from "./events.js";
import {GossipValidationResult} from "./gossipValidationResult.js";
import {AnchorSummary, EngineBootstrap} from "./initialization.js";
import {IBeaconEngineOptions} from "./options.js";
import type {ProduceBlindedBlockOrBlockContentsRes} from "./produceEngineOrBuilderBlock.js";

export type HeadParentPayload = {
  blockRoot: Root;
  blockRootHex: RootHex;
  slot: Slot;
  proposerIndex: ValidatorIndex;
  forkName: ForkName;
  bid: gloas.ExecutionPayloadBid;
};

/** The bootstrap or attested header slot determines the SSZ fork and network context. */
export type SerializedLightClientData = {data: Uint8Array; slot: Slot};

export type BeaconEngineModules = {
  core: IBeaconEngineCore;
  emitter: ChainEventEmitter;
};

export type BeaconEngineCoreModules = {
  serializedCache?: SerializedCache;
  blockSerializedCache?: BlockSerializedCache;
  builderApiClientOpts?: BuilderApiClientOpts;
  executionEngine: IExecutionEngine;
  executionBuilder?: IExecutionBuilder;
  opts: IBeaconEngineOptions;
  config: BeaconConfig;
  logger: Logger;
  /** Engine-owned DB directory (historical-state worker location). */
  dbName: string;
  dataColumnDir: string;
  metrics: Metrics | null;
  clock: IClock;
  pubkeyCache: PubkeyCache;
  cpStateDatastore: CPStateDatastore;
  // TODO - beacon engine: emitter is facade infra; forkChoice/regen should not depend on it inside the engine.
  emitter: ChainEventEmitter;
  signal: AbortSignal;
  db: IBeaconEngineDb;
  validatorMonitorOpts: ValidatorMonitorOpts | null;
  validatorMonitorLogger?: Logger;
  isAnchorStateFinalized: boolean;
};

export type VerifyBlocksOpts = BlockProcessOpts & ImportBlockOpts;

export type ImportBlockResult = {
  headChanged: boolean;
  head: {
    block: string;
    slot: number;
    state: string;
    epochTransition: boolean;
    previousDutyDependentRoot: string;
    currentDutyDependentRoot: string;
    executionOptimistic: boolean;
  } | null;
  reorg: ReorgEventData | null;
  blockSummary: ProtoBlock | null;
  newHead: ProtoBlock;
  proposerIndexNextSlot: number | null;
  isExecutionState: boolean;
  prevFinalizedEpoch: number;
  currFinalizedEpoch: number;
  oldHeadBlockRoot: string;
  newHeadBlockRoot: string;
  blockMeta: {
    slot: number;
    blockRootHex: string;
    proposerBalanceDelta: number;
    parentBlockSlot: number;
    seenTimestampSec: number;
  };
};

export type ProduceBlockRequest = {
  slot: Slot;
  randaoReveal: BLSSignature;
  graffiti: Bytes32;
  feeRecipient?: string;
  strictFeeRecipientCheck?: boolean;
  builderSelection: routes.validator.BuilderSelection;
  builderBoostFactor: bigint;
};
export type ProduceBlockV4Request = Pick<
  ProduceBlockRequest,
  "slot" | "randaoReveal" | "graffiti" | "feeRecipient" | "strictFeeRecipientCheck"
> & {
  includePayload: boolean;
  builderConfig: routes.validator.BuilderConfig;
};
export type ProduceBlockV4Result = {
  data: gloas.BeaconBlock | gloas.BlockContents;
  meta: routes.validator.ProduceBlockV4Meta;
  executionPayloadSource: ProducedBlockSource;
  produceResult: ProduceResult;
};
export type ProductionError =
  | {ok: false; code: BeaconEngineErrorCode.API_ERROR; payload: {status: ApiError["statusCode"]; message: string}}
  | {
      ok: false;
      code: BeaconEngineErrorCode.NODE_SYNCING | BeaconEngineErrorCode.ABORTED | BeaconEngineErrorCode.INTERNAL;
      payload: {message: string};
    };
export type ProductionResponse<T> = {ok: true; data: T} | ProductionError;
export type ProduceBlockResponse = ProductionResponse<ProduceBlindedBlockOrBlockContentsRes>;
export type ProduceBlockV4Response = ProductionResponse<ProduceBlockV4Result>;

export type PrepareNextSlotOpts = {produceSSEPayloadAttributes: boolean};

export type PrepareNextSlotResult = {
  daPruneParent?: ProtoBlock;
  payloadAttributes?: routes.events.EventData[routes.events.EventType.payloadAttributes];
};

export enum LateCanonicalBlockReason {
  SlowImport = "slow_import",
  LateReceive = "late_receive",
}

export enum BeaconEngineErrorCode {
  ABORTED = "ABORTED",
  INTERNAL = "INTERNAL",
  API_ERROR = "API_ERROR",
  NODE_SYNCING = "NODE_SYNCING",
}

export type PrepareNextSlotResponse =
  | {ok: true; data: PrepareNextSlotResult | null}
  | {ok: false; code: BeaconEngineErrorCode; payload: {message: string}};

/**
 * The consensus engine seam. Starts minimal and transitional (JS-only); ownership of consensus
 * collaborators and flows migrates here across later phases. This interface is the contract shared
 * with the native engine (lodestar-z) — both the JS and native engines implement the same signatures.
 */
/**
 * Result of an engine API state read. `null` = state not found (API → 404); `invalid` = a state-derived
 * validation failure the API maps to `ApiError(code, message)` (keeps the engine HTTP-free); otherwise the
 * targeted `data` + meta. `fork` is included where the response meta needs `version`.
 */
export type ApiStateId = RootHex | Slot | CheckpointWithHex | {head: true};

export type ApiStateResult<T> =
  | {data: T; executionOptimistic: boolean; finalized: boolean; fork?: ForkName}
  | {invalid: {code: number; message: string}}
  | null;

/** Like {@link ApiStateResult} but the success branch always carries `fork` (endpoints with `version` meta). */
export type ApiStateResultWithFork<T> =
  | {data: T; executionOptimistic: boolean; finalized: boolean; fork: ForkName}
  | {invalid: {code: number; message: string}}
  | null;

export type ImportExecutionPayloadOpts = {
  validSignature: boolean;
  source?: PayloadEnvelopeInputSource;
  seenTimestampSec?: number;
};

export type IBeaconEngine = IBeaconEngineCore;

export interface IBeaconEngineCore {
  prepareAnchorState(stateBytes: Uint8Array): Promise<AnchorSummary>;
  persistAnchorState(): Promise<void>;
  initializeFromAnchor(): Promise<EngineBootstrap>;
  readonly events: IBeaconEngineEventBus;
  getChainViewSnapshot(): ChainViewSnapshot;
  readonly config: BeaconConfig;

  getLightClientBootstrap(blockRoot: Root): Promise<SerializedLightClientData>;
  getLightClientUpdate(period: number): Promise<SerializedLightClientData>;
  getLightClientOptimisticUpdate(): Promise<SerializedLightClientData | null>;
  getLightClientFinalityUpdate(): Promise<SerializedLightClientData | null>;
  getLightClientCommitteeRoot(period: number): Promise<Root>;
  pruneLightClientNonCheckpointData(roots: Root[]): Promise<void>;
  validateGossipLightClientOptimisticUpdate(bytes: Uint8Array, fork: ForkName): Promise<GossipValidationResult<void>>;
  validateGossipLightClientFinalityUpdate(bytes: Uint8Array, fork: ForkName): Promise<GossipValidationResult<void>>;

  // Developer API diagnostics only. Operational reads belong to BeaconChain.
  getHeads(): ProtoBlock[];
  getUnrealizedJustifiedCheckpoint(): CheckpointWithHex;
  getUnrealizedFinalizedCheckpoint(): CheckpointWithHex;
  getProposerBoostRoot(): RootHex;
  getPreviousProposerBoostRoot(): RootHex;
  getPTCVoteCounts(blockRootHex: RootHex): {
    attesterCount: number;
    payloadPresentCount: number;
    dataAvailableCount: number;
  } | null;
  getFastConfirmationStore(): ReturnType<IForkChoice["getFastConfirmationStore"]>;
  getConfirmedBlock(): ProtoBlock | null;
  getAllNodes(): ProtoNode[];

  pauseFastConfirmation(): void;
  resumeFastConfirmation(): void;

  // Cold block-archive writes + reverse-lookup (backfill).
  persistArchiveBlock(
    slot: Slot,
    serializedBytes: Uint8Array,
    blockRoot: Uint8Array,
    parentRoot: Uint8Array
  ): Promise<void>;
  batchPersistArchiveBlocks(
    entries: {slot: Slot; bytes: Uint8Array; blockRoot: Uint8Array; parentRoot: Uint8Array}[]
  ): Promise<void>;

  produceBlock(request: ProduceBlockRequest): Promise<ProduceBlockResponse>;
  produceBlockV4(request: ProduceBlockV4Request): Promise<ProduceBlockV4Response>;

  // Advance preparation for the next slot: recompute head, regen the prepare-state, predict a
  // proposer-boost-reorg, precompute the epoch transition and prepare the EL/builder.
  // Returns requested payload attributes and an optional parent for facade-owned DA pruning.
  prepareForNextSlot(clockSlot: Slot, opts: PrepareNextSlotOpts): Promise<PrepareNextSlotResponse>;

  // Validator duties. The engine resolves state internally and returns fully-populated duties (with
  // pubkeys) + dependentRoot; no `IBeaconStateView` crosses. Clock-derived values are passed in (the
  // engine holds no clock): `currentEpoch` for head-state resolution, and `checkpointWaitTimeoutMs` (a
  // relative deadline, set only near the boundary) for the proposer next-epoch checkpoint wait. The
  // past-epoch proposer state crosses as `pastStateBytes` (facade-owned archive until the DB phase).
  getProposerDuties(
    epoch: Epoch,
    timing: {currentEpoch: Epoch; checkpointWaitTimeoutMs?: number},
    v2: boolean
  ): Promise<{data: routes.validator.ProposerDuty[]; dependentRoot: Root; head: ProtoBlock}>;
  getAttesterDuties(
    epoch: Epoch,
    indices: ValidatorIndex[],
    currentEpoch: Epoch
  ): Promise<{data: routes.validator.AttesterDuty[]; dependentRoot: Root; head: ProtoBlock}>;
  getSyncCommitteeDuties(
    epoch: Epoch,
    indices: ValidatorIndex[]
  ): {data: routes.validator.SyncDuty[]; head: ProtoBlock};
  getPtcDuties(
    epoch: Epoch,
    indices: ValidatorIndex[],
    currentEpoch: Epoch
  ): Promise<{data: routes.validator.PtcDuty[]; dependentRoot: Root; head: ProtoBlock}>;

  // State reads (regen-backed; no IBeaconStateView crosses — the engine resolves state internally and
  // returns scalars / DTOs). See BLK-3.
  dumpCacheSummary(): routes.lodestar.StateCacheItem[];
  dropCache(): Promise<void>;
  dumpRegenQueueItems(): {key: RegenRequest["key"]; args: RegenRequest; addedTimeMs: number}[];
  getActiveValidatorCount(): number;
  getHeadPendingCounts(): {
    pendingDeposits: number;
    pendingPartialWithdrawals: number;
    pendingConsolidations: number;
  } | null;
  registerLocalValidators(indices: ValidatorIndex[]): Promise<void>;
  registerLocalValidatorsInSyncCommittee(
    subscriptions: {validatorIndex: ValidatorIndex; untilEpoch: Epoch}[]
  ): Promise<void>;
  registerApiBlock(seenTimestampSec: number, block: ValidatorMonitorBlock): Promise<void>;
  registerApiExecutionPayloadEnvelope(
    delaySec: number,
    signedExecutionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope
  ): Promise<void>;
  onPoolSubmitUnaggregatedAttestation(
    seenTimestampSec: number,
    attestation: ValidatorMonitorAttestation,
    subnet: SubnetID,
    sentPeers: number
  ): Promise<void>;
  onPoolSubmitAggregatedAttestation(
    seenTimestampSec: number,
    attestation: ValidatorMonitorAttestation,
    sentPeers: number
  ): Promise<void>;
  getMonitoredValidatorIndices(): Promise<ValidatorIndex[]>;
  scrapeValidatorMonitorMetrics(): Promise<string>;
  initRegen(): Promise<void>;
  /** Tear down engine-owned resources (historical-state regen worker, BLS pool, …). */
  close(): Promise<void>;
  getHeadExecutionStateInfo(): {isExecutionStateType: boolean; isMergeTransitionComplete: boolean};
  getLatestWeakSubjectivityCheckpointEpoch(): Epoch;
  // Historical (below-finalized) state serving — engine-owned worker (--serveHistoricalState).
  loadHistoricalStateRegen(): Promise<void>;
  scrapeHistoricalStateMetrics(): Promise<string>;
  // API state queries — the engine resolves the state internally (no IBeaconStateView crosses). `id` is
  // the resolved stateId (root / slot / checkpoint); the API keeps `resolveStateId` (400 on bad input).
  getSerializedState(
    id: ApiStateId
  ): Promise<{state: Uint8Array; executionOptimistic: boolean; finalized: boolean} | null>;
  getFinalizedEffectiveBalances(
    finalizedCheckpoint: CheckpointWithHex,
    validatorIndices: ValidatorIndex[]
  ): Promise<number[] | null>;
  getStateProof(id: ApiStateId, descriptor: Uint8Array): Promise<{proof: CompactMultiProof; fork: ForkName} | null>;
  getHistoricalSummaries(id: ApiStateId): Promise<{
    slot: Slot;
    historicalSummaries: capella.HistoricalSummaries;
    proof: Uint8Array[];
    fork: ForkName;
    executionOptimistic: boolean;
    finalized: boolean;
  } | null>;
  getIndexedAttestationsForSlashing(
    requests: {slot: Slot; epoch: Epoch; attestations: Attestation[]}[],
    forkSeq: ForkSeq
  ): Promise<IndexedAttestation[]>;
  // beacon/state family — each returns the endpoint DTO (or invalid/null); no IBeaconStateView crosses.
  getStateBuilders(
    id: ApiStateId,
    builderIds: routes.beacon.BuilderId[],
    statuses: string[]
  ): Promise<ApiStateResult<routes.beacon.BuilderResponse[]>>;
  getStateRoot(id: ApiStateId): Promise<ApiStateResult<{root: Root}>>;
  getStateFork(id: ApiStateId): Promise<ApiStateResult<phase0.Fork>>;
  getStateRandao(id: ApiStateId, epoch?: Epoch): Promise<ApiStateResult<{randao: Bytes32}>>;
  getStateFinalityCheckpoints(id: ApiStateId): Promise<
    ApiStateResult<{
      currentJustified: phase0.Checkpoint;
      previousJustified: phase0.Checkpoint;
      finalized: phase0.Checkpoint;
    }>
  >;
  getStateValidators(
    id: ApiStateId,
    validatorIds: routes.beacon.ValidatorId[],
    statuses: string[]
  ): Promise<ApiStateResult<routes.beacon.ValidatorResponse[]>>;
  getStateValidatorIdentities(
    id: ApiStateId,
    validatorIds: routes.beacon.ValidatorId[]
  ): Promise<ApiStateResult<routes.beacon.ValidatorIdentities>>;
  getStateValidator(
    id: ApiStateId,
    validatorId: routes.beacon.ValidatorId
  ): Promise<ApiStateResult<routes.beacon.ValidatorResponse>>;
  getStateValidatorBalances(
    id: ApiStateId,
    validatorIds: routes.beacon.ValidatorId[]
  ): Promise<ApiStateResult<routes.beacon.ValidatorBalance[]>>;
  getEpochCommittees(
    id: ApiStateId,
    filters: {epoch?: Epoch; index?: CommitteeIndex; slot?: Slot}
  ): Promise<ApiStateResult<routes.beacon.EpochCommitteeResponse[]>>;
  getStatePtc(id: ApiStateId, slot?: Slot): Promise<ApiStateResult<{slot: Slot; validators: ValidatorIndex[]}>>;
  getEpochSyncCommittees(
    id: ApiStateId,
    epoch?: Epoch
  ): Promise<ApiStateResult<routes.beacon.EpochSyncCommitteeResponse>>;
  getStatePendingDeposits(
    id: ApiStateId,
    returnBytes: boolean
  ): Promise<ApiStateResultWithFork<Uint8Array | electra.PendingDeposits>>;
  getStatePendingPartialWithdrawals(
    id: ApiStateId,
    returnBytes: boolean
  ): Promise<ApiStateResultWithFork<Uint8Array | electra.PendingPartialWithdrawals>>;
  getStatePendingConsolidations(
    id: ApiStateId,
    returnBytes: boolean
  ): Promise<ApiStateResultWithFork<Uint8Array | electra.PendingConsolidations>>;
  getStateProposerLookahead(
    id: ApiStateId,
    returnBytes: boolean
  ): Promise<ApiStateResultWithFork<Uint8Array | fulu.ProposerLookahead>>;
  getHeadProposerPubkey(slot: Slot): Uint8Array;
  getBuilderPendingPayments(
    id: ApiStateId,
    returnBytes: boolean
  ): Promise<ApiStateResultWithFork<Uint8Array | gloas.BuilderPendingPayments>>;
  getBuilderPendingWithdrawals(
    id: ApiStateId,
    returnBytes: boolean
  ): Promise<ApiStateResultWithFork<Uint8Array | gloas.BuilderPendingWithdrawals>>;
  getHeadParentPayload(): HeadParentPayload | undefined;
  getActiveOrPendingValidators(indices: ValidatorIndex[]): Set<ValidatorIndex>;
  getAttestationSourceCheckpoint(attEpoch: Epoch): Promise<phase0.Checkpoint>;
  getBlockRewards(block: BeaconBlock | BlindedBeaconBlock): Promise<rewards.BlockRewards>;
  getAttestationsRewards(
    epoch: Epoch,
    validatorIds?: (ValidatorIndex | string)[]
  ): Promise<{rewards: rewards.AttestationsRewards; executionOptimistic: boolean; finalized: boolean}>;
  getSyncCommitteeRewards(
    block: BeaconBlock | BlindedBeaconBlock,
    validatorIds?: (ValidatorIndex | string)[]
  ): Promise<rewards.SyncCommitteeRewards>;

  /**
   * Always returns a validation result, including decoding failures. Invalid SSZ or a mismatched
   * root returns Reject; unexpected internal failures are logged and return Ignore/UNEXPECTED_ERROR.
   */
  validateGossipBlock(
    blockRoot: Root,
    blockBytes: Uint8Array,
    fork: ForkName,
    seenTimestampSec?: number
  ): Promise<GossipValidationResult<GossipBlockValidationResult>>;
  validateGossipSyncCommittee(syncCommitteeBytes: Uint8Array, subnet: SubnetID): Promise<GossipValidationResult<void>>;
  validateApiSyncCommittee(
    syncCommitteeBytes: Uint8Array,
    syncCommittee: altair.SyncCommitteeMessage
  ): Promise<GossipValidationResult<{subnets: number[]}>>;
  validateSyncCommitteeGossipContributionAndProof(
    contributionBytes: Uint8Array,
    skipValidationKnownParticipants?: boolean
  ): Promise<GossipValidationResult<{syncCommitteeParticipantIndices: ValidatorIndex[]}>>;
  validateApiSyncCommitteeContributionAndProof(
    contributionBytes: Uint8Array,
    signedContributionAndProof: altair.SignedContributionAndProof
  ): Promise<GossipValidationResult<void>>;
  validateGossipBlobSidecar(
    blobBytes: Uint8Array,
    fork: ForkName,
    subnet: SubnetID
  ): Promise<GossipValidationResult<void>>;
  validateGossipFuluDataColumnSidecar(
    dataColumnBytes: Uint8Array,
    gossipSubnet: SubnetID
  ): Promise<GossipValidationResult<void>>;
  validateGossipGloasDataColumnSidecar(
    dataColumnBytes: Uint8Array,
    gossipSubnet: SubnetID
  ): Promise<GossipValidationResult<void>>;
  validateGossipPayloadAttestationMessage(payloadAttestationBytes: Uint8Array): Promise<GossipValidationResult<void>>;
  validateApiPayloadAttestationMessage(
    payloadAttestationBytes: Uint8Array,
    payloadAttestationMessage: gloas.PayloadAttestationMessage
  ): Promise<GossipValidationResult<void>>;
  validateGossipAttestationsSameAttData(
    fork: ForkName,
    attestations: GossipAttestation[],
    seenTimestampSecs: number[]
  ): Promise<{results: GossipValidationResult<AttestationValidationResult>[]; batchableBls: boolean}>;
  prepareBeaconCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void>;
  validateApiAttestation(
    fork: ForkName,
    attestationOrBytes: ApiAttestation
  ): Promise<GossipValidationResult<AttestationValidationResult>>;
  validateGossipAggregateAndProof(
    aggregateBytes: Uint8Array,
    fork: ForkName,
    seenTimestampSec: number
  ): Promise<GossipValidationResult<{indexedAttestation: IndexedAttestation}>>;
  validateApiAggregateAndProof(
    aggregateBytes: Uint8Array,
    fork: ForkName,
    signedAggregateAndProof: SignedAggregateAndProof
  ): Promise<GossipValidationResult<{indexedAttestation: IndexedAttestation}>>;
  validateGossipExecutionPayloadEnvelope(
    envelopeBytes: Uint8Array,
    source: SourceMeta
  ): Promise<GossipValidationResult<void>>;
  validateApiExecutionPayloadEnvelope(
    envelopeBytes: Uint8Array,
    executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope,
    seenTimestampSec: number
  ): Promise<GossipValidationResult<void>>;
  validateGossipExecutionPayloadBid(
    bidBytes: Uint8Array,
    fork: ForkName,
    seenTimestampSec: number
  ): Promise<GossipValidationResult<{proposerIndex: ValidatorIndex}>>;
  validateApiExecutionPayloadBid(
    bidBytes: Uint8Array,
    signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid
  ): Promise<GossipValidationResult<void>>;
  validateGossipProposerPreferences(preferencesBytes: Uint8Array): Promise<GossipValidationResult<void>>;

  // Op pool: gossip validate (+ insert on Accept) / API validate (throws, + insert) / REST reads. The
  // pools live inside the engine (not exposed as cache objects); the facade reaches them only here.
  validateGossipAttesterSlashing(
    attesterSlashingBytes: Uint8Array,
    fork: ForkName
  ): Promise<GossipValidationResult<void>>;
  validateApiAttesterSlashing(attesterSlashing: AttesterSlashing, fork: ForkName): Promise<void>;
  validateGossipProposerSlashing(proposerSlashingBytes: Uint8Array): Promise<GossipValidationResult<void>>;
  validateApiProposerSlashing(proposerSlashing: phase0.ProposerSlashing): Promise<void>;
  validateGossipVoluntaryExit(voluntaryExitBytes: Uint8Array): Promise<GossipValidationResult<void>>;
  validateApiVoluntaryExit(
    voluntaryExit: phase0.SignedVoluntaryExit
  ): Promise<ApiVoluntaryExitResult & {inserted?: boolean}>;
  drainDeferredVoluntaryExits(): phase0.SignedVoluntaryExit[];
  insertVoluntaryExit(exit: phase0.SignedVoluntaryExit): void;
  processProposerEquivocation(slot: Slot, proposerIndex: ValidatorIndex): void;
  validateGossipBlsToExecutionChange(blsToExecutionChangeBytes: Uint8Array): Promise<GossipValidationResult<void>>;
  validateApiBlsToExecutionChange(
    blsToExecutionChange: capella.SignedBLSToExecutionChange,
    preCapella: boolean
  ): Promise<void>;
  getPoolProposerPreferences(slot?: Slot, dependentRoot?: RootHex): gloas.SignedProposerPreferences[];
  getPoolAttesterSlashings(): AttesterSlashing[];
  getPoolProposerSlashings(): phase0.ProposerSlashing[];
  getPoolVoluntaryExits(): phase0.SignedVoluntaryExit[];
  getPoolBlsToExecutionChanges(): capella.SignedBLSToExecutionChange[];

  // Op pools (engine-internal): narrow add/read bridges for gossip handlers + REST/validator API.
  addAttestationToPool(
    committeeIndex: CommitteeIndex,
    attestation: SingleAttestation,
    attDataRootHex: RootHex,
    validatorCommitteeIndex: number,
    committeeSize: number,
    priority?: boolean
  ): InsertOutcome;
  getAttestationAggregate(slot: Slot, dataRootHex: RootHex, committeeIndex: CommitteeIndex): Attestation | null;
  getPoolAggregatedAttestations(bySlot?: Slot): Attestation[];
  getSyncCommitteeContribution(
    subnet: SubcommitteeIndex,
    slot: Slot,
    prevBlockRoot: Root
  ): altair.SyncCommitteeContribution | null;
  getPoolPayloadAttestations(slot?: Slot): gloas.PayloadAttestation[];

  // Proposer cache + finalized balances (engine-internal).
  getProposerFeeRecipient(proposerIndex: ValidatorIndex): string | undefined;
  trackAttachedValidators(epoch: Epoch, validatorIndices: ValidatorIndex[]): boolean;
  updateProposerPreparation(epoch: Epoch, proposers: ProposerPreparationData[]): boolean;
  getProposerCacheValidatorIndices(): ValidatorIndex[];
  getCheckpointEffectiveBalances(checkpoint: CheckpointWithHex): EffectiveBalanceIncrements | undefined;

  /** Prune the (internal) op pool + seen-block-proposers on finalization — driven by the facade's finalized event. */
  pruneOnFinalized(): Promise<void>;
  /** Liveness: whether the validator was seen via imported blocks or gossip/API in the epoch. */
  validatorSeenAtEpoch(index: ValidatorIndex, epoch: Epoch): boolean;
  /** Whether a block proposer was already seen for this slot (sync anti-unbundling check). */
  observeVerifiedBlocks(blocks: {block: SignedBeaconBlock; root: RootHex}[], verifyOnly: boolean): void;
  markBlockProposersSeen(blocks: {slot: Slot; proposerIndex: ValidatorIndex; root: RootHex}[]): void;
  recomputeForkChoiceHead(caller: ForkchoiceCaller): ProtoBlock;
  hasObservedBlockRoot(slot: Slot, proposerIndex: ValidatorIndex, root: RootHex): boolean;
  isBlockProposerEquivocating(slot: Slot, proposerIndex: ValidatorIndex): boolean;
  getConflictingBlockRoots(slot: Slot, proposerIndex: ValidatorIndex, root: RootHex): RootHex[];
  verifyAndObserveBlockProposer(bytes: Uint8Array, block: SignedBeaconBlock, root: RootHex): Promise<void>;
  verifyEnvelopeForPublish(
    bytes: Uint8Array,
    envelope: gloas.SignedExecutionPayloadEnvelope,
    blockRootHex: RootHex
  ): Promise<void>;
  isBlockProposerSeen(slot: Slot, proposerIndex: ValidatorIndex): boolean;

  /**
   * Consensus checks for API broadcast validation, without EL submission or retaining an import bundle.
   * Never changes verifiedBlocks: a concurrent import may already own a bundle for this root.
   * The facade must still wait for DA before observing the proposer and publishing the block.
   */
  validateApiBlock(
    blockRoot: Root,
    blockBytes: Uint8Array,
    opts: VerifyBlocksOpts,
    // TODO - beacon engine: handle AbortSignal across the worker boundary.
    signal: AbortSignal
  ): Promise<void>;
  /** Retains verified block bundles until importBlock or discardVerifiedBlocks releases them. */
  verifyBlocks(
    blocks: BlockBytes[],
    opts: VerifyBlocksOpts,
    // TODO - beacon engine: handle AbortSignal across the worker boundary.
    signal: AbortSignal
  ): Promise<{segmentExecStatus: SegmentExecStatus; verifyStateTime: number; verifySignaturesTime: number}>;
  // `blockRoot` is the SSZ root as raw bytes (the verify output handle, import input) — bytes-first for
  // the native engine FFI. The JS engine keys its internal cache by hex (converted here).
  importBlock(
    blockRoot: Root,
    dataAvailabilityStatus: DataAvailabilityStatus,
    opts: ImportBlockOpts
  ): Promise<ImportBlockResult>;
  discardVerifiedBlocks(blockRootHexes: RootHex[]): void;

  // Fork-choice writes routed through the engine (so the facade never writes fork choice directly).
  updateTime(currentSlot: Slot): void;

  // Source: unstable@1bf214377e chain/blocks/importExecutionPayload.ts.
  // The facade supplies DA; the engine verifies, persists and imports the envelope in one call.
  importExecutionPayload(
    envelopeBytes: Uint8Array,
    dataAvailabilityStatus: DataAvailabilityStatus,
    opts: ImportExecutionPayloadOpts
  ): Promise<{executionOptimistic: boolean}>;

  // --- DB ownership (blocks + states + payload envelopes) ---

  // TODO - beacon engine: preserve this ordered archive protocol in the worker implementation.
  migrateCanonicalBlocks(): Promise<Slot[]>;
  migrateExecutionPayloadEnvelopes(): Promise<Slot[]>;
  deleteNonCanonicalExecutionPayloadEnvelopes(roots: Uint8Array[]): Promise<void>;
  persistOrphanedBlocks(blocks: FinalizedProtoSummary[], directory?: string): Promise<void>;
  deleteNonCanonicalBlocks(roots: Uint8Array[]): Promise<void>;
  completeFinalization(finalized: CheckpointWithHex): Promise<number>;
  getEarliestArchivedBlockSlot(): Promise<Slot | null>;

  /** Persist the latest finalized state to the (engine-owned) archive DB — used on graceful shutdown. */
  persistFinalizedStateToDisk(): Promise<void>;

  /** Prune finalized blocks, states and envelopes below the retention window. */
  pruneHistory(finalizedEpoch: Epoch, currentEpoch: Epoch): Promise<Slot>;

  /** Load / persist the (engine-owned) op pool from/to its DB repos. Facade lifecycle delegates here. */
  loadOpPoolFromDisk(): Promise<void>;
  persistOpPoolToDisk(): Promise<void>;
}
