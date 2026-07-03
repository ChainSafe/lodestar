import {routes} from "@lodestar/api";
import {BeaconConfig} from "@lodestar/config";
import {
  BlockExecutionStatus,
  CheckpointWithHex,
  IForkChoice,
  PayloadExecutionStatus,
  PayloadStatus,
  ProtoBlock,
} from "@lodestar/fork-choice";
import {ForkName, ForkPostBellatrix} from "@lodestar/params";
import {DataAvailabilityStatus, PubkeyCache} from "@lodestar/state-transition";
import {
  BLSPubkey,
  BLSSignature,
  BeaconBlock,
  BlindedBeaconBlock,
  Bytes32,
  Epoch,
  Gwei,
  Root,
  RootHex,
  SSEPayloadAttributes,
  SignedAggregateAndProof,
  SignedBeaconBlock,
  Slot,
  SubnetID,
  ValidatorIndex,
  altair,
  deneb,
  fulu,
  gloas,
} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {IBeaconDb} from "../../db/index.js";
import {Metrics} from "../../metrics/index.js";
import {BufferPool} from "../../util/bufferPool.js";
import {IClock} from "../../util/clock.js";
import {BlockRootSlot} from "../../util/sszBytes.js";
import {IBlockInput} from "../blocks/blockInput/index.js";
import {PayloadEnvelopeInput} from "../blocks/payloadEnvelopeInput/index.js";
import {ImportBlockOpts} from "../blocks/types.js";
import {ChainEventEmitter, ReorgEventData} from "../emitter.js";
import {CommonBlockBody} from "../interface.js";
import {LightClientServer} from "../lightClient/index.js";
import {BlockProcessOpts} from "../options.js";
import {
  BlockAttributes,
  PayloadAttributesInput,
  PayloadAttributesWithdrawals,
} from "../produceBlock/produceBlockBody.js";
import {SeenBlockInput} from "../seenCache/seenGossipBlockInput.js";
import {ShufflingCache} from "../shufflingCache.js";
import {CPStateDatastore} from "../stateCache/datastore/types.js";
import {AggregateAndProofValidationResult} from "../validation/aggregateAndProof.js";
import {ApiAttestation, AttestationValidationResult, GossipAttestation} from "../validation/attestation.js";
import {GossipBlockValidationResult} from "../validation/block.js";
import {PayloadAttestationValidationResult} from "../validation/payloadAttestationMessage.js";
import {ValidatorMonitor} from "../validatorMonitor.js";
import {GossipValidationResult} from "./gossipValidationResult.js";
import {IBeaconEngineOptions} from "./options.js";

export type BeaconEngineModules = {
  opts: IBeaconEngineOptions;
  config: BeaconConfig;
  logger: Logger;
  metrics: Metrics | null;
  clock: IClock;
  pubkeyCache: PubkeyCache;
  bufferPool: BufferPool;
  cpStateDatastore: CPStateDatastore;
  // TODO - beacon engine: emitter is facade infra; forkChoice/regen should not depend on it inside the engine.
  emitter: ChainEventEmitter;
  signal: AbortSignal;
  db: IBeaconDb;
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
  /**
   * Head ProtoBlock after this import (result of updateAndGetHead). The facade caches it and derives
   * the finalized/justified transition (its `finalized*`/`justified*` fields) + `getStatus` from it,
   * instead of the engine emitting `forkChoiceFinalized`/`forkChoiceJustified` (FFI-honest).
   */
  newHead: ProtoBlock;
  proposerIndexNextSlot: number | null;
  isExecutionState: boolean;
  prevFinalizedEpoch: number;
  currFinalizedEpoch: number;
  oldHeadBlockRoot: string;
  newHeadBlockRoot: string;
  attestations: {blockEpoch: number; attestingIndices: number[]}[];
  blockMeta: {
    slot: number;
    blockRootHex: string;
    proposerBalanceDelta: number;
    parentBlockSlot: number;
    seenTimestampSec: number;
  };
};

/**
 * Shared head of block production, computed once by `produceBlockBase` and reused across the
 * self-build and builder-bid paths. Holds no `BeaconState` — only scalar fields the downstream flow
 * needs plus the (still-pending) common block body.
 */
export type ProduceBlockBaseResult = {
  parentBlock: ProtoBlock;
  proposerIndex: ValidatorIndex;
  proposerPubKey: BLSPubkey;
  safeBlockHash: RootHex;
  finalizedBlockHash: RootHex;
  /** EL payload-attribute timestamp (computeTimeAtSlot) */
  timestamp: number;
  prevRandao: Bytes32;
  /** self-build parent execution block hash (gloas: from the bid; bellatrix: from the header) */
  parentBlockHash: Bytes32;
  /** parent execution gas limit (gloas: from the bid; bellatrix: from the header) */
  parentGasLimit: number;
  /** gloas: forkChoice.shouldBuildOnFull(parentBlock, slot); false pre-gloas */
  isBuildingOnFull: boolean;
  /** gloas: best bid from the (engine-owned) executionPayloadBidPool; null otherwise */
  builderBid: gloas.SignedExecutionPayloadBid | null;
  /** gloas: parent execution requests applied to produce the common body (default = empty / build-on-empty) */
  parentExecutionRequests: gloas.ExecutionRequests;
  /** gloas: payload attestations for the parent block's payload (slot - 1); empty pre-gloas */
  payloadAttestations: gloas.PayloadAttestation[];
  /** payload-attribute withdrawals resolved from the parent-payload-applied state (post-capella) */
  withdrawals?: PayloadAttributesWithdrawals;
  /** gloas: proposer target gas limit, resolved engine-side so the facade self-build EL call passes it
   * as plain data (mirrors the prepareForNextSlot path); undefined pre-gloas */
  targetGasLimit?: number;
  /** common body produced from the parent-payload-applied state — its voluntaryExits are already valid */
  commonBlockBodyPromise: Promise<CommonBlockBody>;
};

/**
 * Result of `prepareForNextSlot`. The engine does all consensus work internally (head recompute, regen,
 * proposer-boost-reorg prediction, `hashTreeRoot`, epoch-transition precompute) and returns only the
 * side-effects the facade must perform (EL advance-prep + builder, DA prune, SSE emit). `null` = nothing
 * for the facade to do.
 */
export type PrepareNextSlotResult = {
  /**
   * Non-null ONLY when this node proposes the next slot (the `beaconProposerCache` fee-recipient
   * resolves). When null the facade does NO builder status and NO EL `prepareExecutionPayload`.
   */
  elPrep: {
    fork: ForkPostBellatrix;
    proposerIndex: ValidatorIndex;
    feeRecipient: string;
    parentBlockRoot: Root;
    parentBlockHash: Bytes32;
    safeBlockHash: RootHex;
    finalizedBlockHash: RootHex;
    prepareSlot: Slot;
    payloadAttributesInput: PayloadAttributesInput;
    /** gloas: proposer target gas limit, resolved engine-side so the facade EL call never reaches back
     * into engine internals (fork choice / proposer-preferences pool); undefined pre-gloas */
    targetGasLimit?: number;
  } | null;
  /** gloas: parent ProtoBlock of the (possibly reorged) head; facade prunes the DA seen cache below it */
  daPruneParent: ProtoBlock | null;
  /** built only when (proposing || emitPayloadAttributes) AND the emitter has listeners; facade emits it */
  sse: {data: SSEPayloadAttributes; version: ForkName} | null;
};

/**
 * Plain-scalar summary of a finalized proto-block returned from `migrateFinalized`. No `BeaconState`
 * and no live `ProtoBlock` handle crosses the seam — only the fields the facade needs to migrate/prune
 * the DA + light-client artifacts it still owns.
 */
export type FinalizedProtoSummary = {
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
export interface IBeaconEngine {
  readonly config: BeaconConfig;
  // Full fork choice (read + write). The engine owns it; writes are routed here while the flows that
  // perform them still live facade-side. TODO - beacon engine: narrow to a read facet as those flows
  // (gossip → Phase 3, migrateFinalized/prune → Phase 5) move into the engine.
  readonly forkChoice: IForkChoice;
  // TODO - beacon engine: the engine owns the shuffling cache; exposed for the committees API
  // (`getEpochCommittees`) until that read becomes an engine method.
  readonly shufflingCache: ShufflingCache;

  // Block production. `produceCommonBlockBody` builds the fork-agnostic body part (reused across the
  // self-build / builder-bid paths). `produceBlockBase` computes the shared head once (proposer head,
  // builder-bid lookup, forkChoice exec hashes, base-state scalars) so they are not recomputed per path.
  // More of the production flow migrates here in later steps.
  getProposerHead(slot: Slot): ProtoBlock;
  // Execution payload envelope DB (engine-owned). Roots cross as raw bytes (FFI-honest).
  getExecutionPayloadEnvelope(
    blockSlot: Slot,
    blockRoot: Uint8Array
  ): Promise<gloas.SignedExecutionPayloadEnvelope | null>;
  getSerializedExecutionPayloadEnvelope(blockSlot: Slot, blockRoot: Uint8Array): Promise<Uint8Array | null>;
  getSerializedFinalizedExecutionPayloadEnvelope(slot: Slot): Promise<Uint8Array | null>;
  persistExecutionPayloadEnvelope(blockRoot: Uint8Array, serializedBytes: Uint8Array): Promise<void>;
  // Thin serving refs for ExecutionPayloadEnvelopesByRange — fork choice read engine-side, no ProtoBlock crosses.
  getFullBlockRootSlotsByRange(startSlot: Slot, endSlot: Slot): {finalizedSlot: Slot; nonFinalized: BlockRootSlot[]};
  produceCommonBlockBody(blockAttributes: BlockAttributes): Promise<CommonBlockBody>;
  produceBlockBase(attrs: {slot: Slot; randaoReveal: BLSSignature; graffiti: Bytes32}): Promise<ProduceBlockBaseResult>;
  // Compute the post-state root + proposer reward for a produced block.
  computeNewStateRoot(
    block: BeaconBlock | BlindedBeaconBlock,
    blockBytes: Uint8Array,
    blinded: boolean
  ): Promise<{newStateRoot: Root; proposerReward: Gwei}>;

  // Advance preparation for the next slot: recompute head, regen the prepare-state, predict a
  // proposer-boost-reorg, precompute the epoch transition and cache `hashTreeRoot`. Returns the
  // side-effects the facade performs (EL advance-prep + builder, DA prune, SSE emit); `null` = no-op.
  prepareForNextSlot(clockSlot: Slot): Promise<PrepareNextSlotResult | null>;

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
  ): Promise<GossipValidationResult<{indicesInSubcommittee: number[]}>>;
  validateApiSyncCommittee(
    syncCommitteeBytes: Uint8Array,
    syncCommittee: altair.SyncCommitteeMessage
  ): Promise<GossipValidationResult<void>>;
  validateSyncCommitteeGossipContributionAndProof(
    contributionBytes: Uint8Array,
    signedContributionAndProof: altair.SignedContributionAndProof,
    skipValidationKnownParticipants?: boolean
  ): Promise<GossipValidationResult<{syncCommitteeParticipantIndices: ValidatorIndex[]}>>;
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
  ): Promise<GossipValidationResult<PayloadAttestationValidationResult>>;
  validateApiPayloadAttestationMessage(
    payloadAttestationBytes: Uint8Array,
    payloadAttestationMessage: gloas.PayloadAttestationMessage
  ): Promise<GossipValidationResult<PayloadAttestationValidationResult>>;
  validateGossipAttestationsSameAttData(
    fork: ForkName,
    attestations: GossipAttestation[]
  ): Promise<{results: GossipValidationResult<AttestationValidationResult>[]; batchableBls: boolean}>;
  validateApiAttestation(
    fork: ForkName,
    attestationOrBytes: ApiAttestation
  ): Promise<GossipValidationResult<AttestationValidationResult>>;
  validateGossipAggregateAndProof(
    aggregateBytes: Uint8Array,
    fork: ForkName,
    signedAggregateAndProof: SignedAggregateAndProof
  ): Promise<GossipValidationResult<AggregateAndProofValidationResult>>;
  validateApiAggregateAndProof(
    aggregateBytes: Uint8Array,
    fork: ForkName,
    signedAggregateAndProof: SignedAggregateAndProof
  ): Promise<GossipValidationResult<AggregateAndProofValidationResult>>;
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
    signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid
  ): Promise<GossipValidationResult<{proposerIndex: ValidatorIndex}>>;
  validateApiExecutionPayloadBid(
    bidBytes: Uint8Array,
    signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid
  ): Promise<GossipValidationResult<{proposerIndex: ValidatorIndex}>>;
  validateGossipProposerPreferences(
    preferencesBytes: Uint8Array,
    signedProposerPreferences: gloas.SignedProposerPreferences
  ): Promise<GossipValidationResult<void>>;
  verifyBlocks(
    _blockBytes: Uint8Array[],
    parentBlock: ProtoBlock,
    blockInputs: IBlockInput[],
    opts: BlockProcessOpts & ImportBlockOpts,
    signal: AbortSignal
  ): Promise<{verifyStateTime: number; verifySignaturesTime: number}>;
  // `blockRoot` is the SSZ root as raw bytes (the verify output handle, import input) — bytes-first for
  // the native engine FFI. The JS engine keys its internal cache by hex (converted here).
  importBlock(
    blockRoot: Root,
    executionStatus: BlockExecutionStatus | PayloadExecutionStatus,
    dataAvailabilityStatus: DataAvailabilityStatus,
    opts: ImportBlockOpts
  ): Promise<ImportBlockResult>;
  discardVerifiedBlocks(blockRootHexes: RootHex[]): void;

  // --- DB ownership (blocks + states) ---

  /**
   * Process a newly finalized checkpoint: migrate canonical blocks hot→cold, archive the finalized
   * state, prune fork choice — all engine-owned persistence, consolidated into one method. Returns the
   * canonical/non-canonical block snapshot the facade uses to clean the DA + light-client artifacts it
   * owns. State bytes never cross; archival is internal.
   */
  migrateFinalized(finalized: CheckpointWithHex): Promise<MigrateFinalizedResult>;

  /** Persist the latest finalized state to the (engine-owned) archive DB — used on graceful shutdown. */
  persistFinalizedStateToDisk(): Promise<void>;

  /**
   * On a new checkpoint: prune regen caches and archive a temp checkpoint state (engine-owned states DB).
   * The facade keeps only the event listener + error handling.
   */
  archiveStateOnCheckpoint(): Promise<void>;
}
