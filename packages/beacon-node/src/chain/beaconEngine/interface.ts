import type {PubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {CompactMultiProof} from "@chainsafe/persistent-merkle-tree";
import {routes} from "@lodestar/api";
import type {ApiError} from "@lodestar/api/server";
import {BeaconConfig} from "@lodestar/config";
import type {IForkChoice} from "@lodestar/fork-choice";
import {CheckpointWithHex, PayloadExecutionStatus, PayloadStatus, ProtoBlock, ProtoNode} from "@lodestar/fork-choice";
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
  deneb,
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
import {IClock} from "../../util/clock.js";
import {BlockRootSlot} from "../../util/sszBytes.js";
import {ProposerPreparationData} from "../beaconProposerCache.js";
import {IBlockInput} from "../blocks/blockInput/index.js";
import {PayloadEnvelopeInput} from "../blocks/payloadEnvelopeInput/index.js";
import {ImportBlockOpts} from "../blocks/types.js";
import {SegmentExecStatus} from "../blocks/verifyBlocksExecutionPayloads.js";
import {IBlsVerifier} from "../bls/index.js";
import {ChainViewSnapshot} from "../chainView/interface.js";
import {ChainEventEmitter, ReorgEventData} from "../emitter.js";
import {ForkchoiceCaller} from "../forkChoice/index.js";
import {LightClientServer} from "../lightClient/index.js";
import {InsertOutcome} from "../opPools/types.js";
import {BlockProcessOpts} from "../options.js";
import {ProduceResult} from "../produceBlock/produceBlockBody.js";
import {RegenRequest} from "../regen/index.js";
import {SeenBlockInput} from "../seenCache/seenGossipBlockInput.js";
import {CPStateDatastore} from "../stateCache/datastore/types.js";
import {ApiAttestation, AttestationValidationResult, GossipAttestation} from "../validation/attestation.js";
import {GossipBlockValidationResult} from "../validation/block.js";
import type {ApiVoluntaryExitResult} from "../validation/voluntaryExit.js";
import {ValidatorMonitor} from "../validatorMonitor.js";
import {IBeaconEngineEventBus} from "./events.js";
import {GossipValidationResult} from "./gossipValidationResult.js";
import {AnchorSummary, EngineBootstrap} from "./initialization.js";
import {IBeaconEngineOptions} from "./options.js";
import type {ProduceBlindedBlockOrBlockContentsRes} from "./produceEngineOrBuilderBlock.js";

export type BeaconEngineModules = {
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
  validatorMonitor: ValidatorMonitor | null;
  seenBlockInputCache: SeenBlockInput;
  isAnchorStateFinalized: boolean;
  lightClientServer?: LightClientServer;
};

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

/** The DA prune parent returned after engine-owned slot preparation. */
export type PrepareNextSlotResult = {daPruneParent: ProtoBlock};

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
 * Plain-scalar summary of a finalized proto-block returned from `migrateFinalized`. No `BeaconState`
 * and no live `ProtoBlock` handle crosses the seam — only the fields the facade needs to migrate/prune
 * the DA + light-client artifacts it still owns.
 */
export type FinalizedProtoSummary = Pick<ProtoBlock, "executionStatus" | "timeliness" | "importedTimely"> & {
  slot: Slot;
  /** hex, as ProtoBlock carries it; the facade does `fromHex()` where it needs bytes */
  blockRoot: RootHex;
  /** gloas FULL-gate for column/payload-envelope migration (`getForkSeq(slot) < gloas || FULL`) */
  payloadStatus: PayloadStatus;
};

/**
 * Canonical/non-canonical block snapshot for a finalized checkpoint, computed by the engine from its
 * own fork choice. The facade drives all DA/light-client cleanup from this (never re-reading fork choice).
 */
export type FinalizedBlockSnapshot = {
  /** canonical ancestors of the finalized root, newest→oldest; last = previous-finalized boundary block */
  canonical: FinalizedProtoSummary[];
  /** non-canonical (orphaned) blocks pruned by this finalization */
  nonCanonical: FinalizedProtoSummary[];
};

export type MigrateFinalizedResult = {
  snapshot: FinalizedBlockSnapshot;
  /** fork-choice prune result; facade only reads `.length` for its log */
  prunedBlocks: ProtoBlock[];
};

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

export interface IBeaconEngine {
  prepareAnchorState(stateBytes: Uint8Array): Promise<AnchorSummary>;
  persistAnchorState(): Promise<void>;
  initializeFromAnchor(): Promise<EngineBootstrap>;
  readonly events: IBeaconEngineEventBus;
  getChainViewSnapshot(): ChainViewSnapshot;
  readonly config: BeaconConfig;

  // Engine diagnostics and full parent metadata used by block verification.
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
  pauseFastConfirmation(): void;
  resumeFastConfirmation(): void;
  getConfirmedBlock(): ProtoBlock | null;
  getBlockDefaultStatus(blockRoot: Root): ProtoBlock | null;
  getBlockHexDefaultStatus(blockRoot: RootHex): ProtoBlock | null;
  getBlockHexAndBlockHash(blockRoot: RootHex, blockHash: RootHex): ProtoBlock | null;
  getAllNodes(): ProtoNode[];

  // Block + state DB (engine-owned). Bytes-only — no `SignedBeaconBlock`/`BeaconState` crosses the seam.
  getSerializedUnfinalizedBlockByRoot(root: Uint8Array): Promise<Uint8Array | null>;
  getSerializedBlockByRoot(root: Uint8Array): Promise<{bytes: Uint8Array; slot: Slot; finalized: boolean} | null>;
  getRecentCanonicalRoots(startSlot: Slot, endSlot: Slot): Map<Slot, RootHex | null>;
  getFinalizedBlockRootBySlot(slot: Slot): Promise<Root | null>;
  getSerializedFinalizedBlockBySlot(slot: Slot): Promise<Uint8Array | null>;
  getFinalizedBlockSlotByRoot(root: Uint8Array): Promise<Slot | null>;
  getSerializedFinalizedBlockByParentRoot(parentRoot: Uint8Array): Promise<Uint8Array | null>;
  persistBlock(root: Uint8Array, serializedBytes: Uint8Array): Promise<void>;
  getSerializedStateByRoot(stateRoot: Uint8Array): Promise<Uint8Array | null>;
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
  getSerializedArchiveBlockBefore(slot: Slot): Promise<{slot: Slot; bytes: Uint8Array} | null>;

  produceBlock(request: ProduceBlockRequest): Promise<ProduceBlockResponse>;
  produceBlockV4(request: ProduceBlockV4Request): Promise<ProduceBlockV4Response>;

  // Advance preparation for the next slot: recompute head, regen the prepare-state, predict a
  // proposer-boost-reorg, precompute the epoch transition, prepare the EL/builder and emit SSE.
  // Returns a plain error or success with an optional parent for facade-owned DA pruning.
  prepareForNextSlot(clockSlot: Slot): Promise<PrepareNextSlotResponse>;

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
  validatorMonitorOnceEveryEndOfEpoch(): void;
  regenCanAcceptWork(): boolean;
  /**
   * The shared, stateless JS BLS verifier the facade uses for backfill + DA-sidecar proposer-signature
   * verification. A carve-out to the "methods only, no objects" rule — BLS is shared JS infra, not native
   * consensus state. `NativeBeaconEngine` returns a JS verifier here and forwards its own internal
   * (gossip/import) verification to the binding, so chain-bls and engine-internal bls are distinct.
   */
  chainBls(): IBlsVerifier;
  /** Backpressure for the engine's internal (gossip/import) BLS pool — the binding's pool under native. */
  blsCanAcceptWork(): boolean;
  initRegen(): Promise<void>;
  /** Tear down engine-owned resources (historical-state regen worker, BLS pool, …). */
  close(): Promise<void>;
  getHeadExecutionStateInfo(): {isExecutionStateType: boolean; isMergeTransitionComplete: boolean};
  getLatestWeakSubjectivityCheckpointEpoch(): Epoch;
  // Historical (below-finalized) state serving — engine-owned worker (--serveHistoricalState).
  loadHistoricalStateRegen(): Promise<void>;
  scrapeHistoricalStateMetrics(): Promise<string>;
  getHistoricalStateBySlot(
    slot: Slot
  ): Promise<{state: Uint8Array; executionOptimistic: boolean; finalized: boolean} | null>;
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
  getHeadLatestExecutionPayloadBid(): gloas.ExecutionPayloadBid | undefined;
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

  // Gossip + API validation flows. The first parameter is the message's SSZ bytes (unused by the JS
  // engine, required by the native engine's bytes-first contract), followed by the deserialized object. Each
  // returns a `GossipValidationResult` (no throw) so the native engine can return outcomes across FFI.
  validateGossipBlock(
    blockBytes: Uint8Array,
    signedBlock: SignedBeaconBlock,
    fork: ForkName
  ): Promise<GossipValidationResult<GossipBlockValidationResult>>;
  validateGossipSyncCommittee(
    syncCommitteeBytes: Uint8Array,
    syncCommittee: altair.SyncCommitteeMessage,
    subnet: SubnetID
  ): Promise<GossipValidationResult<void>>;
  validateApiSyncCommittee(
    syncCommitteeBytes: Uint8Array,
    syncCommittee: altair.SyncCommitteeMessage
  ): Promise<GossipValidationResult<{subnets: number[]}>>;
  validateSyncCommitteeGossipContributionAndProof(
    contributionBytes: Uint8Array,
    signedContributionAndProof: altair.SignedContributionAndProof,
    skipValidationKnownParticipants?: boolean
  ): Promise<GossipValidationResult<{syncCommitteeParticipantIndices: ValidatorIndex[]}>>;
  validateApiSyncCommitteeContributionAndProof(
    contributionBytes: Uint8Array,
    signedContributionAndProof: altair.SignedContributionAndProof
  ): Promise<GossipValidationResult<void>>;
  validateGossipBlobSidecar(
    blobBytes: Uint8Array,
    fork: ForkName,
    blobSidecar: deneb.BlobSidecar,
    subnet: SubnetID
  ): Promise<GossipValidationResult<void>>;
  validateGossipFuluDataColumnSidecar(
    dataColumnBytes: Uint8Array,
    dataColumnSidecar: fulu.DataColumnSidecar,
    gossipSubnet: SubnetID
  ): Promise<GossipValidationResult<void>>;
  validateGossipGloasDataColumnSidecar(
    dataColumnBytes: Uint8Array,
    payloadInput: PayloadEnvelopeInput,
    dataColumnSidecar: gloas.DataColumnSidecar,
    gossipSubnet: SubnetID
  ): Promise<GossipValidationResult<void>>;
  validateGossipPayloadAttestationMessage(
    payloadAttestationBytes: Uint8Array,
    payloadAttestationMessage: gloas.PayloadAttestationMessage
  ): Promise<GossipValidationResult<void>>;
  validateApiPayloadAttestationMessage(
    payloadAttestationBytes: Uint8Array,
    payloadAttestationMessage: gloas.PayloadAttestationMessage
  ): Promise<GossipValidationResult<void>>;
  validateGossipAttestationsSameAttData(
    fork: ForkName,
    attestations: GossipAttestation[],
    shouldAddToPool: boolean[]
  ): Promise<{results: GossipValidationResult<AttestationValidationResult>[]; batchableBls: boolean}>;
  validateApiAttestation(
    fork: ForkName,
    attestationOrBytes: ApiAttestation
  ): Promise<GossipValidationResult<AttestationValidationResult>>;
  validateGossipAggregateAndProof(
    aggregateBytes: Uint8Array,
    fork: ForkName,
    signedAggregateAndProof: SignedAggregateAndProof
  ): Promise<GossipValidationResult<{indexedAttestation: IndexedAttestation}>>;
  validateApiAggregateAndProof(
    aggregateBytes: Uint8Array,
    fork: ForkName,
    signedAggregateAndProof: SignedAggregateAndProof
  ): Promise<GossipValidationResult<{indexedAttestation: IndexedAttestation}>>;
  // The bid scalars + proposerIndex are looked up facade-side from the `PayloadEnvelopeInput` (the engine
  // no longer touches the DA seen cache) and passed in.
  validateGossipExecutionPayloadEnvelope(
    envelopeBytes: Uint8Array,
    executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope,
    proposerIndex: ValidatorIndex,
    bidBuilderIndex: ValidatorIndex,
    bidBlockHashHex: RootHex,
    bidExecutionRequestsRoot: Root
  ): Promise<GossipValidationResult<void>>;
  validateApiExecutionPayloadEnvelope(
    envelopeBytes: Uint8Array,
    executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope,
    proposerIndex: ValidatorIndex,
    bidBuilderIndex: ValidatorIndex,
    bidBlockHashHex: RootHex,
    bidExecutionRequestsRoot: Root
  ): Promise<GossipValidationResult<void>>;
  validateGossipExecutionPayloadBid(
    bidBytes: Uint8Array,
    signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid,
    seenTimestampSec: number
  ): Promise<GossipValidationResult<{proposerIndex: ValidatorIndex}>>;
  validateApiExecutionPayloadBid(
    bidBytes: Uint8Array,
    signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid
  ): Promise<GossipValidationResult<void>>;
  validateGossipProposerPreferences(
    preferencesBytes: Uint8Array,
    signedProposerPreferences: gloas.SignedProposerPreferences
  ): Promise<GossipValidationResult<void>>;

  // Op pool: gossip validate (+ insert on Accept) / API validate (throws, + insert) / REST reads. The
  // pools live inside the engine (not exposed as cache objects); the facade reaches them only here.
  validateGossipAttesterSlashing(
    attesterSlashing: AttesterSlashing,
    fork: ForkName
  ): Promise<GossipValidationResult<void>>;
  validateApiAttesterSlashing(attesterSlashing: AttesterSlashing, fork: ForkName): Promise<void>;
  validateGossipProposerSlashing(proposerSlashing: phase0.ProposerSlashing): Promise<GossipValidationResult<void>>;
  validateApiProposerSlashing(proposerSlashing: phase0.ProposerSlashing): Promise<void>;
  validateGossipVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): Promise<GossipValidationResult<void>>;
  validateApiVoluntaryExit(
    voluntaryExit: phase0.SignedVoluntaryExit
  ): Promise<ApiVoluntaryExitResult & {inserted?: boolean}>;
  drainDeferredVoluntaryExits(): phase0.SignedVoluntaryExit[];
  insertVoluntaryExit(exit: phase0.SignedVoluntaryExit): void;
  processProposerEquivocation(slot: Slot, proposerIndex: ValidatorIndex): void;
  validateGossipBlsToExecutionChange(
    blsToExecutionChange: capella.SignedBLSToExecutionChange
  ): Promise<GossipValidationResult<void>>;
  validateApiBlsToExecutionChange(
    blsToExecutionChange: capella.SignedBLSToExecutionChange,
    preCapella: boolean
  ): Promise<void>;
  getPoolProposerPreferences(slot?: Slot): gloas.SignedProposerPreferences[];
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
  isDescendant(root: RootHex, status: PayloadStatus, descendantRoot: RootHex, descendantStatus: PayloadStatus): boolean;
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

  verifyBlocks(
    _blockBytes: Uint8Array[],
    parentBlock: ProtoBlock,
    blockInputs: IBlockInput[],
    opts: BlockProcessOpts & ImportBlockOpts,
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
  getIrrecoverableError(): Error | undefined;

  // Execution payload envelope (gloas) import — consensus body of the facade `importExecutionPayload`.
  // `verifyExecutionPayloadEnvelope` (regen state + fields + BLS sig, throws `PayloadError`) runs
  // facade-parallel to the EL `notifyNewPayload`; `importExecutionPayload` does the fork-choice write
  // and FCU dispatch, persisting execution requests before FULL. The facade awaits import before events.
  // Bytes-first (native FFI): `envelopeBytes`
  // is the SSZ envelope (JS engine ignores it, uses the pojo); `blockRoot` is the SSZ root as raw bytes.
  verifyExecutionPayloadEnvelope(
    envelopeBytes: Uint8Array,
    signedEnvelope: gloas.SignedExecutionPayloadEnvelope,
    proposerIndex: ValidatorIndex,
    opts: {validSignature: boolean}
  ): Promise<void>;
  importExecutionPayload(
    blockRoot: Root,
    blockHashHex: RootHex,
    payloadBlockNumber: number,
    payloadGasLimit: number,
    executionRequests: gloas.ExecutionRequests,
    execStatus: PayloadExecutionStatus,
    dataAvailabilityStatus: DataAvailabilityStatus
  ): Promise<{executionOptimistic: boolean}>;

  // --- DB ownership (blocks + states + execution requests) ---

  /**
   * Process a newly finalized checkpoint: migrate canonical blocks hot→cold, archive the finalized
   * state, prune execution requests, prune fork choice — all engine-owned persistence. Returns the
   * canonical/non-canonical block snapshot the facade uses to clean the envelopes + DA + light-client artifacts it
   * owns. State bytes never cross; archival is internal.
   */
  // TODO - beacon engine: preserve this ordered archive protocol in the worker implementation.
  getFinalizedBlockSnapshot(root: RootHex): FinalizedBlockSnapshot;
  migrateCanonicalBlocks(blocks: BlockRootSlot[]): Promise<Slot[]>;
  persistOrphanedBlocks(blocks: FinalizedProtoSummary[], directory?: string): Promise<void>;
  deleteNonCanonicalBlocks(roots: Uint8Array[]): Promise<void>;
  completeFinalization(finalized: CheckpointWithHex): Promise<number>;
  getEarliestArchivedBlockSlot(): Promise<Slot | null>;

  /** Persist the latest finalized state to the (engine-owned) archive DB — used on graceful shutdown. */
  persistFinalizedStateToDisk(): Promise<void>;

  /**
   * On a new checkpoint: prune regen caches and archive a temp checkpoint state (engine-owned states DB).
   * The facade keeps only the event listener + error handling.
   */
  archiveStateOnCheckpoint(): Promise<void>;

  /** Prune finalized blocks + states below the retention window (engine-owned block/state DB). */
  pruneHistory(finalizedEpoch: Epoch, currentEpoch: Epoch): Promise<Slot>;

  /** Load / persist the (engine-owned) op pool from/to its DB repos. Facade lifecycle delegates here. */
  loadOpPoolFromDisk(): Promise<void>;
  persistOpPoolToDisk(): Promise<void>;
}
