import {CompactMultiProof} from "@chainsafe/persistent-merkle-tree";
import {routes} from "@lodestar/api";
import type {ApiError} from "@lodestar/api/server";
import {BeaconConfig, SpecJson} from "@lodestar/config";
import {CheckpointWithHex, ExecutionStatus, ProtoBlock} from "@lodestar/fork-choice";
import {LoggerNodeOpts} from "@lodestar/logger/node";
import {ForkName, ForkPostBellatrix, ForkPreGloas, ForkSeq} from "@lodestar/params";
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
  SSEPayloadAttributes,
  SignedBlockContents,
  SingleAttestation,
  Slot,
  SubcommitteeIndex,
  SubnetID,
  ValidatorIndex,
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
import {ExecutionBuilderOpts, ExecutionEngineOpts, IExecutionEngine} from "../../execution/index.js";
import {ScrapedMetrics} from "../../metrics/index.js";
import {CommitteeSubscription} from "../../network/subnets/interface.js";
import {IClock} from "../../util/clock.js";
import {Result} from "../../util/wrapError.js";
import {ProposerPreparationData} from "../beaconProposerCache.js";
import {BlockBytes} from "../blocks/blockSerializedCache.js";
import {PayloadEnvelopeInputSource, SourceMeta} from "../blocks/payloadEnvelopeInput/types.js";
import {SignedBlockRoot} from "../blocks/signedBlockRoot.js";
import {ImportBlockOpts} from "../blocks/types.js";
import {SegmentExecStatus} from "../blocks/verifyBlocksExecutionPayloads.js";
import {ChainViewBlock, ChainViewSnapshot} from "../chainView/interface.js";
import {BlockErrorCode} from "../errors/blockError.js";
import {ForkchoiceCaller} from "../forkChoice/index.js";
import {InsertOutcome} from "../opPools/types.js";
import {BlockProcessOpts} from "../options.js";
import {ProduceResult} from "../produceBlock/produceBlockBody.js";
import {RegenRequest} from "../regen/index.js";
import {CPStateDatastore} from "../stateCache/datastore/types.js";
import {ApiAttestation, AttestationValidationResult, GossipAttestation} from "../validation/attestation.js";
import type {ApiVoluntaryExitResult} from "../validation/voluntaryExit.js";
import {ValidatorMonitorAttestation, ValidatorMonitorBlock, ValidatorMonitorOpts} from "../validatorMonitor.js";
import {ChainReorg, HeadUpdate} from "./events.js";
import {GossipBlockResult} from "./gossipValidation/block.js";
import {GossipValidationResult} from "./gossipValidationResult.js";
import {AnchorSummary, EngineBootstrapWithChainView} from "./initialization.js";
import {IBeaconEngineOptions} from "./options.js";
import {BlockFailure, PayloadFailure} from "./processingResult.js";
import type {ProduceBlindedBlockOrBlockContentsRes} from "./produceEngineOrBuilderBlock.js";

export type HeadExecutionStateInfo = {
  isExecutionStateType: boolean;
  isMergeTransitionComplete: boolean;
  executionStatus: ExecutionStatus;
  executionPayloadBlockHash: RootHex | null;
  executionPayloadNumber?: number;
};

export type PayloadAttestationBlock = Pick<ProtoBlock, "blockRoot" | "slot">;

export type FinalizedProtoSummary<TRoot = RootHex> = Pick<ProtoBlock, "slot" | "payloadStatus"> & {
  blockRoot: TRoot;
};

export type FinalizedBlockSnapshot<TRoot = RootHex> = {
  canonical: FinalizedProtoSummary<TRoot>[];
  nonCanonical: FinalizedProtoSummary<TRoot>[];
};

export type FinalizedCheckpointSnapshot<TRoot = RootHex> = phase0.Checkpoint & {
  slot: Slot;
  stateRoot: Root;
  executionOptimistic: boolean;
  blockSnapshot: FinalizedBlockSnapshot<TRoot>;
};

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

export type BeaconEngineLogging =
  | {
      type: "injected";
      logger: Logger;
      executionEngineLogger?: Logger;
      validatorMonitorLogger?: Logger;
    }
  | {
      type: "options";
      opts: LoggerNodeOpts;
    };

export type BeaconEngineCoreModules = {
  builderApiClientOpts?: BuilderApiClientOpts;
  executionEngine?: IExecutionEngine;
  executionEngineOpts?: ExecutionEngineOpts & {config?: never};
  executionBuilderOpts?: ExecutionBuilderOpts;
  opts: IBeaconEngineOptions;
  logging: BeaconEngineLogging;
  /** Shared LevelDB location, also used by the historical-state worker. */
  dbName: string;
  dataDir: string;
  dataColumnDir: string;
  metricsEnabled: boolean;
  genesisTime: number;
  /** Shared in-process clock; omitted when the core needs its own worker-local clock. */
  clock?: IClock;
  cpStateDatastore?: CPStateDatastore;
  /** Borrowed repositories; when omitted, Core opens dbName and owns that connection. */
  db?: IBeaconEngineDb;
  validatorMonitorOpts: ValidatorMonitorOpts | null;
  isAnchorStateFinalized: boolean;
} & (
  | {config: BeaconConfig; chainConfigJson?: never; genesisValidatorsRoot?: never}
  | {config?: never; chainConfigJson: SpecJson; genesisValidatorsRoot: Uint8Array}
);

export type VerifyBlocksOpts = BlockProcessOpts & ImportBlockOpts;

/** Verification metadata only; live post-states and import bundles remain inside Core in both modes. */
export type VerifyBlocksSuccess = {
  segmentExecStatus: Extract<SegmentExecStatus, {execAborted: null}>;
  verifyStateTime: number;
  verifySignaturesTime: number;
};

export type VerifyGossipBlockResult = Result<
  VerifyBlocksSuccess,
  BlockFailure | {code: BlockErrorCode.GOSSIP_BLOCK_NOT_CACHED}
>;

export type ImportBlockResult = {
  block: ChainViewBlock;
  newHead: ChainViewBlock;
  executionOptimistic: boolean;
};

export type ImportBlockResponse = {
  block: ChainViewBlock<Root>;
  newHead: ChainViewBlock<Root>;
  justified: phase0.Checkpoint;
  finalized: phase0.Checkpoint;
  executionOptimistic: boolean;
  /** Head updates are common during block import, so return the data here to avoid another Core round trip. */
  headUpdate: HeadUpdate<Root> | null;
  reorg: ChainReorg<Root> | null;
  justifiedCheckpointChanged: boolean;
  /** Finalization is infrequent; the facade pulls its larger block snapshot only when the checkpoint changes. */
  finalizedCheckpointChanged: boolean;
  version: number;
};

export type OnSlotResponse = {
  /** Head root or payload status changed */
  headUpdate: boolean;
  justifiedCheckpointChanged: boolean;
  finalizedCheckpointChanged: boolean;
};

export type HeadSnapshot = {
  head: ChainViewBlock<Root>;
  justified: phase0.Checkpoint;
  finalized: phase0.Checkpoint;
  version: number;
  headUpdate: HeadUpdate<Root> | null;
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
export type ProduceBlockResponse = ProductionResponse<ProduceBlindedBlockOrBlockContentsRes> & {headUpdate: boolean};
export type ProduceBlockV4Response = ProductionResponse<ProduceBlockV4Result> & {headUpdate: boolean};

export type SubmitBlindedBlockResponse = {
  signedBlockContents: SignedBlockContents;
  /** Existing worker response bytes: SignedBeaconBlock before Deneb, SignedBlockContents from Deneb. */
  contentsBytes?: Uint8Array;
};

export type PrepareNextSlotOpts = {produceSSEPayloadAttributes: boolean};

export type PrepareNextSlotResult = {
  daPruneParent?: ProtoBlock;
  payloadAttributes?: {version: ForkName; data: SSEPayloadAttributes};
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

export type PrepareNextSlotResponse = {
  /** Refresh head metadata independently of preparation success. */
  headUpdate: boolean;
} & (
  | {ok: true; data: PrepareNextSlotResult | null}
  | {ok: false; code: BeaconEngineErrorCode; payload: {message: string}}
);

/**
 * Result of an engine API state read. `null` = state not found (API → 404); `invalid` = a state-derived
 * validation failure the API maps to `ApiError(code, message)` (keeps the engine HTTP-free); otherwise the
 * targeted `data` + meta. `fork` is included where the response meta needs `version`.
 */
export type ApiStateId = RootHex | Slot | CheckpointWithHex | {head: true};

export type ApiBlockId = Root | Slot | "head" | "genesis" | "finalized" | "justified";

export type BlockRootResponse = {
  data: {root: Root};
  meta: {executionOptimistic: boolean; finalized: boolean};
};

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

export type ImportExecutionPayloadResult = {
  executionOptimistic: boolean;
  block: ChainViewBlock<Root>;
};

/**
 * The consensus engine seam, shared by the JS engine (in-process or worker) and the native engine (lodestar-z).
 * Every method is async so that each implementation can sit behind a thread or FFI boundary.
 */
export interface IBeaconEngineCoreApi {
  // Lifecycle
  init(): Promise<void>;
  prepareAnchorState(stateBytes: Uint8Array): Promise<AnchorSummary>;
  persistAnchorState(): Promise<void>;
  initializeFromAnchor(): Promise<EngineBootstrapWithChainView>;
  initRegen(): Promise<void>;
  // Historical (below-finalized) state serving — engine-owned worker (--serveHistoricalState).
  loadHistoricalStateRegen(): Promise<void>;
  /** Tear down engine-owned resources (historical-state regen worker, BLS pool, …). */
  close(): Promise<void>;

  // Clock / fork choice / head
  onSlot(slot: Slot): Promise<OnSlotResponse>;
  onEpoch(epoch: Epoch): Promise<void>;
  // Advance preparation for the next slot: recompute head, regen the prepare-state, predict a
  // proposer-boost-reorg, precompute the epoch transition and prepare the EL/builder.
  // Returns requested payload attributes and an optional parent for facade-owned DA pruning.
  prepareForNextSlot(clockSlot: Slot, opts: PrepareNextSlotOpts): Promise<PrepareNextSlotResponse>;
  recomputeForkChoiceHead(caller: ForkchoiceCaller): Promise<{headUpdate: boolean}>;
  /** Include head-event metadata only when a previous ChainView head is supplied. */
  getHeadSnapshot(previousHead?: Pick<ChainViewBlock<Root>, "blockRoot" | "payloadStatus">): Promise<HeadSnapshot>;
  getChainViewSnapshot(): Promise<ChainViewSnapshot>;
  getFinalizedCheckpointSnapshot(): Promise<FinalizedCheckpointSnapshot<Root>>;
  getPayloadExecutionOptimistic(blockRoot: Root): Promise<boolean | null>;
  isHeadOptimistic(): Promise<boolean>;
  getHeadExecutionStateInfo(): Promise<HeadExecutionStateInfo>;
  pauseFastConfirmation(): Promise<void>;
  resumeFastConfirmation(): Promise<void>;

  // Block processing
  /**
   * Consensus checks for API broadcast validation, without EL submission or retaining an import bundle.
   * Never changes verifiedBlocks: a concurrent import may already own a bundle for this signed candidate.
   * Records authenticated proposer headers without triggering slashing production.
   * The facade must still wait for DA before publishing the block.
   */
  validateApiBlockBytes(
    signedBlockRoot: SignedBlockRoot,
    blockBytes: Uint8Array,
    opts: VerifyBlocksOpts
  ): Promise<Result<void, BlockFailure>>;
  /**
   * Marks verified proposals as known independently of DA and retains bundles by signed root until
   * importBlock or discardVerifiedBlocks releases them.
   */
  verifyBlocksBytes(blocks: BlockBytes[], opts: VerifyBlocksOpts): Promise<Result<VerifyBlocksSuccess, BlockFailure>>;
  /**
   * Uses the same verification pipeline as verifyBlocksBytes, for one cached gossip candidate.
   * validateGossipBlockBytes must run first and retain its block/bytes. An absent or evicted candidate
   * returns GOSSIP_BLOCK_NOT_CACHED; its bytes are never requested again through this method.
   */
  verifyGossipBlockBytes(signedBlockRoot: SignedBlockRoot, opts: VerifyBlocksOpts): Promise<VerifyGossipBlockResult>;
  /** Import and release the verification bundle for this exact signed candidate. */
  importBlock(
    signedBlockRoot: SignedBlockRoot,
    dataAvailabilityStatus: DataAvailabilityStatus,
    opts: ImportBlockOpts
  ): Promise<Result<ImportBlockResponse, BlockFailure>>;
  // Source: unstable@1bf214377e chain/blocks/importExecutionPayload.ts.
  // The facade supplies DA; the engine verifies, persists and imports the envelope in one call.
  importExecutionPayloadBytes(
    envelopeBytes: Uint8Array,
    dataAvailabilityStatus: DataAvailabilityStatus,
    opts: ImportExecutionPayloadOpts
  ): Promise<Result<ImportExecutionPayloadResult, PayloadFailure>>;
  discardVerifiedBlocks(signedBlockRoots: SignedBlockRoot[]): Promise<void>;
  verifyAndObserveBlockProposerBytes(bytes: Uint8Array, root: RootHex): Promise<void>;
  verifyEnvelopeForPublishBytes(bytes: Uint8Array, blockRootHex: RootHex): Promise<void>;
  isBlockProposerSeen(slot: Slot, proposerIndex: ValidatorIndex): Promise<boolean>;
  getConflictingBlockRoots(slot: Slot, proposerIndex: ValidatorIndex, root: RootHex): Promise<RootHex[]>;

  // Block production / builder
  produceBlock(request: ProduceBlockRequest): Promise<ProduceBlockResponse>;
  produceBlockV4(request: ProduceBlockV4Request): Promise<ProduceBlockV4Response>;
  /** Register a URL already authenticated by the facade, so the engine can warm its local connection. */
  registerAuthenticatedBuilder(url: string): Promise<void>;
  registerValidatorBytes(epoch: Epoch, registrationsBytes: Uint8Array): Promise<void>;
  /**
   * Pre-Fulu path: submit via Builder API v1 and return full block contents for BeaconChain to gossip.
   * Returns SSZ SignedBeaconBlock before Deneb, or SignedBlockContents from Deneb.
   */
  submitBlindedBlockBytes(
    signedBlindedBlockBytes: Uint8Array,
    fork: ForkPostBellatrix & ForkPreGloas
  ): Promise<Uint8Array>;
  /** Fulu path (before Gloas): submit via Builder API v2; the relay publishes and returns only an acknowledgement. */
  submitBlindedBlockNoResponseBytes(
    signedBlindedBlockBytes: Uint8Array,
    fork: ForkPostBellatrix & ForkPreGloas
  ): Promise<void>;
  produceAttestationData(
    slot: Slot,
    committeeIndex?: CommitteeIndex
  ): Promise<ProductionResponse<phase0.AttestationData>>;
  produceSyncCommitteeContribution(
    subnet: SubcommitteeIndex,
    slot: Slot,
    blockRoot: Root
  ): Promise<ProductionResponse<Uint8Array | null>>;
  getPayloadAttestationBlock(slot: Slot): Promise<PayloadAttestationBlock | null>;

  // Validator duties / proposer cache
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
  ): Promise<{data: routes.validator.SyncDuty[]; head: ProtoBlock}>;
  getInclusionListCommitteeDuties(
    epoch: Epoch,
    indices: ValidatorIndex[],
    currentEpoch: Epoch
  ): Promise<{data: routes.validator.InclusionListDuty[]; dependentRoot: Root; head: ProtoBlock}>;
  getInclusionListsByIndices(slot: Slot, dependentRoot: Root, indices: Uint8Array): Promise<Uint8Array[]>;
  validateGossipInclusionListBytes(
    listBytes: Uint8Array,
    seenTimestampSec: number
  ): Promise<GossipValidationResult<{totalBytes: number}>>;
  getPtcDuties(
    epoch: Epoch,
    indices: ValidatorIndex[],
    currentEpoch: Epoch
  ): Promise<{data: routes.validator.PtcDuty[]; dependentRoot: Root; head: ProtoBlock}>;
  getProposerFeeRecipient(proposerIndex: ValidatorIndex): Promise<string | undefined>;
  trackAttachedValidators(epoch: Epoch, validatorIndices: ValidatorIndex[]): Promise<boolean>;
  updateProposerPreparation(epoch: Epoch, proposers: ProposerPreparationData[]): Promise<boolean>;
  getProposerCacheValidatorIndices(): Promise<ValidatorIndex[]>;
  prepareBeaconCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void>;
  /** Liveness: whether the validator was seen via imported blocks or gossip/API in the epoch. */
  validatorSeenAtEpoch(index: ValidatorIndex, epoch: Epoch): Promise<boolean>;

  // Gossip / API validation
  /**
   * Always returns a validation result, including decoding failures. Invalid SSZ or a mismatched
   * root returns Reject; unexpected internal failures are logged and return Ignore/UNEXPECTED_ERROR.
   */
  validateGossipBlockBytes(
    signedBlockRoot: SignedBlockRoot,
    blockBytes: Uint8Array,
    fork: ForkName,
    seenTimestampSec?: number
  ): Promise<GossipBlockResult>;
  validateGossipAttestationsSameAttData(
    fork: ForkName,
    attestations: GossipAttestation[],
    seenTimestampSecs: number[]
  ): Promise<{results: GossipValidationResult<AttestationValidationResult>[]; batchableBls: boolean}>;
  validateApiAttestation(
    fork: ForkName,
    attestationOrBytes: ApiAttestation
  ): Promise<GossipValidationResult<AttestationValidationResult>>;
  validateGossipAggregateAndProofBytes(
    aggregateBytes: Uint8Array,
    fork: ForkName,
    seenTimestampSec: number
  ): Promise<GossipValidationResult<{indexedAttestation: IndexedAttestation}>>;
  validateApiAggregateAndProofBytes(
    aggregateBytes: Uint8Array,
    fork: ForkName
  ): Promise<GossipValidationResult<{indexedAttestation: IndexedAttestation}>>;
  validateGossipSyncCommitteeBytes(
    syncCommitteeBytes: Uint8Array,
    subnet: SubnetID
  ): Promise<GossipValidationResult<void>>;
  validateApiSyncCommitteeBytes(syncCommitteeBytes: Uint8Array): Promise<GossipValidationResult<{subnets: number[]}>>;
  validateSyncCommitteeGossipContributionAndProofBytes(
    contributionBytes: Uint8Array,
    skipValidationKnownParticipants?: boolean
  ): Promise<GossipValidationResult<{syncCommitteeParticipantIndices: ValidatorIndex[]}>>;
  validateApiSyncCommitteeContributionAndProofBytes(
    contributionBytes: Uint8Array
  ): Promise<GossipValidationResult<void>>;
  validateGossipBlobSidecarBytes(
    blobBytes: Uint8Array,
    fork: ForkName,
    subnet: SubnetID
  ): Promise<GossipValidationResult<void>>;
  validateGossipFuluDataColumnSidecarBytes(
    dataColumnBytes: Uint8Array,
    gossipSubnet: SubnetID
  ): Promise<GossipValidationResult<void>>;
  validateGossipGloasDataColumnSidecarBytes(
    dataColumnBytes: Uint8Array,
    gossipSubnet: SubnetID
  ): Promise<GossipValidationResult<void>>;
  validateGossipPayloadAttestationMessageBytes(
    payloadAttestationBytes: Uint8Array
  ): Promise<GossipValidationResult<void>>;
  validateApiPayloadAttestationMessageBytes(payloadAttestationBytes: Uint8Array): Promise<GossipValidationResult<void>>;
  validateGossipExecutionPayloadEnvelopeBytes(
    envelopeBytes: Uint8Array,
    source: SourceMeta
  ): Promise<GossipValidationResult<void>>;
  validateApiExecutionPayloadEnvelopeBytes(
    envelopeBytes: Uint8Array,
    seenTimestampSec: number
  ): Promise<GossipValidationResult<void>>;
  validateGossipExecutionPayloadBidBytes(
    bidBytes: Uint8Array,
    fork: ForkName,
    seenTimestampSec: number
  ): Promise<GossipValidationResult<{proposerIndex: ValidatorIndex}>>;
  validateApiExecutionPayloadBidBytes(
    bidBytes: Uint8Array,
    fork: ForkName,
    seenTimestampSec: number
  ): Promise<GossipValidationResult<void>>;
  validateGossipProposerPreferencesBytes(preferencesBytes: Uint8Array): Promise<GossipValidationResult<void>>;

  // Op pools
  validateGossipAttesterSlashingBytes(
    attesterSlashingBytes: Uint8Array,
    fork: ForkName
  ): Promise<GossipValidationResult<void>>;
  validateApiAttesterSlashing(attesterSlashing: AttesterSlashing, fork: ForkName): Promise<void>;
  validateGossipProposerSlashingBytes(proposerSlashingBytes: Uint8Array): Promise<GossipValidationResult<void>>;
  validateApiProposerSlashing(proposerSlashing: phase0.ProposerSlashing): Promise<void>;
  validateGossipVoluntaryExitBytes(voluntaryExitBytes: Uint8Array): Promise<GossipValidationResult<void>>;
  validateApiVoluntaryExit(
    voluntaryExit: phase0.SignedVoluntaryExit
  ): Promise<ApiVoluntaryExitResult & {inserted?: boolean}>;
  drainDeferredVoluntaryExits(): Promise<phase0.SignedVoluntaryExit[]>;
  insertVoluntaryExit(exit: phase0.SignedVoluntaryExit): Promise<void>;
  validateGossipBlsToExecutionChangeBytes(blsToExecutionChangeBytes: Uint8Array): Promise<GossipValidationResult<void>>;
  validateApiBlsToExecutionChange(
    blsToExecutionChange: capella.SignedBLSToExecutionChange,
    preCapella: boolean
  ): Promise<void>;
  addAttestationToPool(
    committeeIndex: CommitteeIndex,
    attestation: SingleAttestation,
    attDataRootHex: RootHex,
    validatorCommitteeIndex: number,
    committeeSize: number,
    priority?: boolean
  ): Promise<InsertOutcome>;
  getAttestationAggregate(
    slot: Slot,
    dataRootHex: RootHex,
    committeeIndex: CommitteeIndex
  ): Promise<Attestation | null>;
  getPoolAggregatedAttestations(bySlot?: Slot): Promise<Attestation[]>;
  getPoolPayloadAttestations(slot?: Slot): Promise<gloas.PayloadAttestation[]>;
  getPoolProposerPreferences(slot?: Slot, dependentRoot?: RootHex): Promise<gloas.SignedProposerPreferences[]>;
  getPoolAttesterSlashings(): Promise<AttesterSlashing[]>;
  getPoolProposerSlashings(): Promise<phase0.ProposerSlashing[]>;
  getPoolVoluntaryExits(): Promise<phase0.SignedVoluntaryExit[]>;
  getPoolBlsToExecutionChanges(): Promise<capella.SignedBLSToExecutionChange[]>;

  // Light client
  getLightClientBootstrap(blockRoot: Root): Promise<SerializedLightClientData>;
  getLightClientUpdate(period: number): Promise<SerializedLightClientData>;
  getLightClientOptimisticUpdate(): Promise<SerializedLightClientData | null>;
  getLightClientFinalityUpdate(): Promise<SerializedLightClientData | null>;
  getLightClientCommitteeRoot(period: number): Promise<Root>;
  pruneLightClientNonCheckpointData(roots: Root[]): Promise<void>;
  validateGossipLightClientOptimisticUpdateBytes(
    bytes: Uint8Array,
    fork: ForkName
  ): Promise<GossipValidationResult<void>>;
  validateGossipLightClientFinalityUpdateBytes(
    bytes: Uint8Array,
    fork: ForkName
  ): Promise<GossipValidationResult<void>>;

  // API block reads
  getBlockRoot(blockId: ApiBlockId): Promise<BlockRootResponse | null>;
  getCanonicalBlockAtSlot(
    slot: Slot
  ): Promise<{block: Uint8Array; slot: Slot; executionOptimistic: boolean; finalized: boolean} | null>;
  getBlockByRoot(
    root: Root
  ): Promise<{block: Uint8Array; slot: Slot; executionOptimistic: boolean; finalized: boolean} | null>;
  getBlockHeaders(opts: {slot?: Slot; parentRoot?: Root}): Promise<{
    data: Uint8Array;
    meta: {executionOptimistic: boolean; finalized: boolean};
  }>;

  // API state reads
  /** Return serialized bytes of a persisted checkpoint state, or the latest safe checkpoint if omitted. */
  getPersistedCheckpointState(checkpoint?: phase0.Checkpoint): Promise<Uint8Array | null>;
  // API state queries — the engine resolves the state internally (no IBeaconStateView crosses). `id` is
  // the resolved stateId (root / slot / checkpoint); the API keeps `resolveStateId` (400 on bad input).
  getSerializedState(
    id: ApiStateId
  ): Promise<{state: Uint8Array; executionOptimistic: boolean; finalized: boolean} | null>;
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
  getBuilderPendingPayments(
    id: ApiStateId,
    returnBytes: boolean
  ): Promise<ApiStateResultWithFork<Uint8Array | gloas.BuilderPendingPayments>>;
  getBuilderPendingWithdrawals(
    id: ApiStateId,
    returnBytes: boolean
  ): Promise<ApiStateResultWithFork<Uint8Array | gloas.BuilderPendingWithdrawals>>;
  getHeadProposerPubkey(slot: Slot): Promise<Uint8Array>;
  getHeadParentPayload(): Promise<HeadParentPayload | undefined>;
  getActiveOrPendingValidators(indices: ValidatorIndex[]): Promise<Set<ValidatorIndex>>;
  getLatestWeakSubjectivityCheckpointEpoch(): Promise<Epoch>;

  // Rewards
  getBlockRewards(block: BeaconBlock | BlindedBeaconBlock): Promise<rewards.BlockRewards>;
  getAttestationsRewards(
    epoch: Epoch,
    validatorIds?: (ValidatorIndex | string)[]
  ): Promise<{rewards: rewards.AttestationsRewards; executionOptimistic: boolean; finalized: boolean}>;
  getSyncCommitteeRewards(
    block: BeaconBlock | BlindedBeaconBlock,
    validatorIds?: (ValidatorIndex | string)[]
  ): Promise<rewards.SyncCommitteeRewards>;

  // Validator monitor
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

  // Debug / metrics
  // Developer API diagnostics only. Operational reads belong to BeaconChain.
  getHeads(): Promise<ProtoBlock[]>;
  getDebugForkChoice(): Promise<routes.debug.ForkChoiceResponse>;
  getDebugForkChoiceV2(): Promise<routes.debug.ForkChoiceResponseV2>;
  getFastConfirmationInfo(): Promise<routes.lodestar.FastConfirmationInfo>;
  getProtoArrayNodes(): Promise<routes.debug.ProtoNodeList>;
  dumpCacheSummary(): Promise<routes.lodestar.StateCacheItem[]>;
  dropCache(): Promise<void>;
  dumpRegenQueueItems(): Promise<{key: RegenRequest["key"]; args: RegenRequest; addedTimeMs: number}[]>;
  scrapeMetrics(): Promise<ScrapedMetrics>;

  // DB / archive / finalization
  persistArchiveBlock(
    slot: Slot,
    serializedBytes: Uint8Array,
    blockRoot: Uint8Array,
    parentRoot: Uint8Array
  ): Promise<void>;
  batchPersistArchiveBlocks(
    entries: {slot: Slot; bytes: Uint8Array; blockRoot: Uint8Array; parentRoot: Uint8Array}[]
  ): Promise<void>;
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
  /** Prune the (internal) op pool + seen-block-proposers on finalization — driven by the facade's finalized event. */
  pruneOnFinalized(): Promise<void>;
  getCheckpointEffectiveBalances(checkpoint: CheckpointWithHex): Promise<EffectiveBalanceIncrements | undefined>;
  getFinalizedEffectiveBalances(
    finalizedCheckpoint: CheckpointWithHex,
    validatorIndices: ValidatorIndex[]
  ): Promise<number[] | null>;
  /** Load / persist the (engine-owned) op pool from/to its DB repos. Facade lifecycle delegates here. */
  loadOpPoolFromDisk(): Promise<void>;
  persistOpPoolToDisk(): Promise<void>;
}
