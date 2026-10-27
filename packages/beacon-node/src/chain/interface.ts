import {type PubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {Type} from "@chainsafe/ssz";
import type {routes} from "@lodestar/api";
import {BeaconConfig} from "@lodestar/config";
import type {ForkName, ForkPostBellatrix, ForkPreGloas} from "@lodestar/params";
import type {DataAvailabilityStatus} from "@lodestar/state-transition";
import {
  type AttesterSlashing,
  BeaconBlock,
  BlindedBeaconBlock,
  DataColumnSidecar,
  Epoch,
  type IndexedAttestation,
  Root,
  RootHex,
  type SignedAggregateAndProof,
  type SignedBeaconBlock,
  type SignedBlindedBeaconBlock,
  Slot,
  Status,
  type SubcommitteeIndex,
  type SubnetID,
  UintNum64,
  ValidatorIndex,
  altair,
  type bellatrix,
  capella,
  deneb,
  type fulu,
  gloas,
  phase0,
} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {BuilderApiClient} from "../execution/builder/apiClient.js";
import {IExecutionEngine} from "../execution/index.js";
import {Metrics} from "../metrics/metrics.js";
import {IClock} from "../util/clock.js";
import {CustodyConfig} from "../util/dataColumns.js";
import {ReconstructMissPolicy} from "../util/execution.js";
import {SerializedCache} from "../util/serializedCache.js";
import {IArchiveStore} from "./archiveStore/interface.js";
import type {GossipBlockResult} from "./beaconEngine/gossipValidation/block.js";
import type {GossipValidationResult} from "./beaconEngine/gossipValidationResult.js";
import type {EngineBootstrap} from "./beaconEngine/initialization.js";
import type {
  BlockRootResponse,
  IBeaconEngineCore,
  ImportBlockResult,
  ImportExecutionPayloadOpts,
  PayloadAttestationBlock,
  PrepareNextSlotOpts,
  PrepareNextSlotResponse,
  ProductionResponse,
  SubmitBlindedBlockResponse,
  VerifyBlocksOpts,
} from "./beaconEngine/interface.js";
import {ProposerPreparationData} from "./beaconProposerCache.js";
import {IBlockInput} from "./blocks/blockInput/index.js";
import type {SourceMeta} from "./blocks/payloadEnvelopeInput/types.js";
import type {SignedBlockRoot} from "./blocks/signedBlockRoot.js";
import {ImportBlockOpts, ImportPayloadOpts, ProcessBlocksResult} from "./blocks/types.js";
import type {SegmentExecStatus} from "./blocks/verifyBlocksExecutionPayloads.js";
import {IBlsVerifier} from "./bls/index.js";
import {ColumnReconstructionTracker} from "./ColumnReconstructionTracker.js";
import type {IChainView} from "./chainView/interface.js";
import {ChainEventEmitter} from "./emitter.js";
import type {ForkchoiceCaller} from "./forkChoice/index.js";
import {GetBlobsTracker} from "./GetBlobsTracker.js";
import {IChainOptions} from "./options.js";
import {AssembledBlockType, BlockType, ProduceResult} from "./produceBlock/produceBlockBody.js";
import {ReprocessController} from "./reprocess.js";
import {SeenBlockInput} from "./seenCache/seenGossipBlockInput.js";
import {PayloadEnvelopeInput, SeenPayloadEnvelopeInput} from "./seenCache/seenPayloadEnvelopeInput.js";

export {BlockType, type AssembledBlockType, type ProposerPreparationData};
export type BlockHash = RootHex;

export type StateGetOpts = {
  allowRegen: boolean;
};

export enum FindHeadFnName {
  recomputeForkChoiceHead = "recomputeForkChoiceHead",
  predictProposerHead = "predictProposerHead",
  getProposerHead = "getProposerHead",
}

/**
 * The IBeaconChain service deals with processing incoming blocks, advancing a state transition
 * and applying the fork choice rule to update the chain head
 */
export interface IBeaconChain {
  readonly genesisTime: UintNum64;
  readonly genesisValidatorsRoot: Root;
  earliestAvailableSlot: Slot;
  readonly executionEngine: IExecutionEngine;

  readonly builderApiClient: BuilderApiClient;
  // Expose config for convenience in modularized functions
  readonly config: BeaconConfig;
  readonly custodyConfig: CustodyConfig;
  readonly logger: Logger;
  readonly metrics: Metrics | null;

  /** The initial slot that the chain is started with */
  readonly anchorStateLatestBlockSlot: Slot;

  readonly beaconEngine: IBeaconEngine;
  readonly bls: IBlsVerifier;
  readonly clock: IClock;
  readonly emitter: ChainEventEmitter;
  readonly reprocessController: ReprocessController;
  readonly pubkeyCache: PubkeyCache;
  readonly archiveStore: IArchiveStore;

  // Op pools are engine-internal (add/read via the engine); not on the facade.
  // Gossip seen caches are engine-internal (pruned + read via the engine); not on the facade.
  readonly seenBlockInputCache: SeenBlockInput;
  readonly seenPayloadEnvelopeInputCache: SeenPayloadEnvelopeInput;

  // beaconProposerCache + checkpointBalancesCache are engine-internal (read/written via the engine).

  readonly blockProductionCache: Map<RootHex, ProduceResult>;

  readonly blacklistedBlocks: Map<RootHex, Slot | null>;
  // Cache for serialized objects
  readonly serializedCache: SerializedCache;

  readonly getBlobsTracker: GetBlobsTracker;
  readonly columnReconstructionTracker: ColumnReconstructionTracker;

  readonly opts: IChainOptions;

  /** Start the processing of chain and load state from disk and related actions */
  init(): Promise<void>;
  /** Stop beacon chain processing */
  close(): Promise<void>;
  /** Chain has seen the specified block root or not. The block may not be processed yet, use forkchoice.hasBlock to check it  */
  seenBlock(blockRoot: RootHex): boolean;
  /** Chain has seen a SignedExecutionPayloadEnvelope for this block root (via seenCache or fork choice FULL variant) */
  seenPayloadEnvelope(blockRoot: RootHex): boolean;
  /** Populate in-memory caches with persisted data. Call at least once on startup */
  loadFromDisk(): Promise<void>;
  /** Persist in-memory data to the DB. Call at least once before stopping the process */
  persistToDisk(): Promise<void>;

  validatorSeenAtEpoch(index: ValidatorIndex, epoch: Epoch): Promise<boolean>;

  /**
   * Get local serialized block by root (bytes-first), does not fetch from the network
   */
  getSerializedBlockByRoot(root: Uint8Array): Promise<{block: Uint8Array; slot: Slot} | null>;
  getSerializedFinalizedBlockByParentRoot(parentRoot: Uint8Array): Promise<Uint8Array | null>;
  getBlobSidecars(blockSlot: Slot, blockRootHex: string): Promise<deneb.BlobSidecars | null>;
  getSerializedBlobSidecars(blockSlot: Slot, blockRootHex: string): Promise<Uint8Array | null>;
  getDataColumnSidecars(blockSlot: Slot, blockRootHex: string): Promise<DataColumnSidecar[]>;
  getSerializedDataColumnSidecars(
    blockSlot: Slot,
    blockRootHex: string,
    indices: number[]
  ): Promise<(Uint8Array | undefined)[]>;
  getSerializedExecutionPayloadEnvelope(blockSlot: Slot, blockRootHex: string): Promise<Uint8Array | null>;
  getSerializedExecutionPayloadEnvelopes(
    requests: {blockSlot: Slot; blockRootHex: RootHex}[],
    onMiss?: ReconstructMissPolicy
  ): Promise<(Uint8Array | null)[]>;
  getExecutionPayloadEnvelope(
    blockSlot: Slot,
    blockRootHex: string
  ): Promise<gloas.SignedExecutionPayloadEnvelope | null>;
  // [beacon-engine] moved to BeaconEngine.getParentExecutionRequests; sync future unstable changes there.
  // getParentExecutionRequests(parentBlockSlot: Slot, parentBlockRootHex: RootHex): Promise<gloas.ExecutionRequests>;

  /** Process a block until complete */
  processBlock(block: IBlockInput, opts?: ImportBlockOpts): Promise<void>;
  /** Process a chain of blocks until complete */
  processChainSegment(
    blocks: IBlockInput[],
    payloadEnvelopes: Map<Slot, PayloadEnvelopeInput> | null,
    opts?: ImportBlockOpts
  ): Promise<ProcessBlocksResult>;

  /** Process execution payload envelope: verify, import to fork choice, and persist to DB */
  processExecutionPayload(payloadInput: PayloadEnvelopeInput, opts?: ImportPayloadOpts): Promise<void>;

  /** Produce and publish a proposer slashing from an observed equivocation. Does not throw, only logs errors */

  getStatus(): Status;

  waitForBlock(slot: Slot, root: RootHex): Promise<boolean>;

  updateBeaconProposerData(epoch: Epoch, proposers: ProposerPreparationData[]): Promise<void>;
  /** Track validators that use this node for duties, e.g. by subscribing to attestation subnets */
  updateAttachedValidators(epoch: Epoch, validatorIndices: ValidatorIndex[]): Promise<void>;

  persistBlock(data: BeaconBlock | BlindedBeaconBlock, suffix?: string): void;
  persistExecutionPayloadEnvelope(envelope: gloas.ExecutionPayloadEnvelope): void;
  persistInvalidSszValue<T>(type: Type<T>, sszObject: T, suffix?: string, rootHex?: RootHex): void;
  persistInvalidSszBytes(type: string, sszBytes: Uint8Array, suffix?: string): void;

  beaconEngineRegenCanAcceptWork(): boolean;
  beaconEngineBlsThreadPoolCanAcceptWork(): boolean;
}

/** Main-thread facade; processing methods reconstruct errors with their local inputs. */
export interface IBeaconEngine
  extends Omit<
    IBeaconEngineCore,
    | "validateGossipLightClientOptimisticUpdateBytes"
    | "validateGossipLightClientFinalityUpdateBytes"
    | "validateGossipBlockBytes"
    | "validateApiBlockBytes"
    | "verifyBlocksBytes"
    | "verifyGossipBlockBytes"
    | "importBlock"
    | "importExecutionPayloadBytes"
    | "registerValidatorBytes"
    | "submitBlindedBlockBytes"
    | "submitBlindedBlockNoResponseBytes"
    | "validateGossipSyncCommitteeBytes"
    | "validateSyncCommitteeGossipContributionAndProofBytes"
    | "validateGossipBlobSidecarBytes"
    | "validateGossipFuluDataColumnSidecarBytes"
    | "validateGossipGloasDataColumnSidecarBytes"
    | "validateGossipPayloadAttestationMessageBytes"
    | "validateGossipAggregateAndProofBytes"
    | "validateGossipExecutionPayloadEnvelopeBytes"
    | "validateGossipExecutionPayloadBidBytes"
    | "validateGossipProposerPreferencesBytes"
    | "validateGossipAttesterSlashingBytes"
    | "validateGossipProposerSlashingBytes"
    | "validateGossipVoluntaryExitBytes"
    | "validateGossipBlsToExecutionChangeBytes"
    | "validateApiSyncCommitteeBytes"
    | "validateApiSyncCommitteeContributionAndProofBytes"
    | "validateApiPayloadAttestationMessageBytes"
    | "validateApiAggregateAndProofBytes"
    | "validateApiExecutionPayloadEnvelopeBytes"
    | "validateApiExecutionPayloadBidBytes"
    | "verifyAndObserveBlockProposerBytes"
    | "verifyEnvelopeForPublishBytes"
    | "pauseFastConfirmation"
    | "resumeFastConfirmation"
    | "recomputeForkChoiceHead"
    | "discardVerifiedBlocks"
    | "onSlot"
    | "onEpoch"
    | "prepareForNextSlot"
    | "getPayloadAttestationBlock"
    | "getFinalizedCheckpointSnapshot"
    | "getHeadSnapshot"
    | "produceSyncCommitteeContribution"
    | "getCanonicalBlockAtSlot"
    | "getBlockByRoot"
    | "getBlockHeaders"
    | "getBlockRoot"
    | "isHeadOptimistic"
    | "initializeFromAnchor"
    | "getChainViewSnapshot"
  > {
  readonly chainView: IChainView;
  initializeFromAnchor(): Promise<EngineBootstrap>;
  validateGossipLightClientOptimisticUpdate(bytes: Uint8Array, fork: ForkName): Promise<GossipValidationResult<void>>;
  validateGossipLightClientFinalityUpdate(bytes: Uint8Array, fork: ForkName): Promise<GossipValidationResult<void>>;
  regenCanAcceptWork(): boolean;
  blsThreadPoolCanAcceptWork(): boolean;
  pauseFastConfirmation(): Promise<void>;
  resumeFastConfirmation(): Promise<void>;
  recomputeForkChoiceHead(caller: ForkchoiceCaller): Promise<void>;
  discardVerifiedBlocks(signedBlockRoots: SignedBlockRoot[]): Promise<void>;
  onSlot(slot: Slot): Promise<void>;
  onEpoch(epoch: Epoch): Promise<void>;
  prepareForNextSlot(clockSlot: Slot, opts: PrepareNextSlotOpts): Promise<PrepareNextSlotResponse>;
  getPayloadAttestationBlock(slot: Slot): Promise<PayloadAttestationBlock | null>;
  isHeadOptimistic(): Promise<boolean>;
  getBlockRoot(blockId: routes.beacon.BlockId): Promise<BlockRootResponse>;
  getCanonicalBlockAtSlot(
    slot: Slot
  ): Promise<{block: SignedBeaconBlock; executionOptimistic: boolean; finalized: boolean} | null>;
  getBlockByRoot(
    root: Root
  ): Promise<{block: SignedBeaconBlock; executionOptimistic: boolean; finalized: boolean} | null>;
  getBlockHeaders(opts: {slot?: Slot; parentRoot?: Root}): Promise<{
    data: routes.beacon.BlockHeaderResponse[];
    meta: {executionOptimistic: boolean; finalized: boolean};
  }>;
  produceSyncCommitteeContribution(
    subnet: SubcommitteeIndex,
    slot: Slot,
    blockRoot: Root
  ): Promise<ProductionResponse<altair.SyncCommitteeContribution | null>>;

  registerValidator(
    epoch: Epoch,
    registrationsBytes: Uint8Array,
    registrations: bellatrix.SignedValidatorRegistrationV1[]
  ): Promise<void>;
  submitBlindedBlock(
    signedBlindedBlockBytes: Uint8Array,
    signedBlindedBlock: SignedBlindedBeaconBlock,
    fork: ForkPostBellatrix & ForkPreGloas
  ): Promise<SubmitBlindedBlockResponse>;
  submitBlindedBlockNoResponse(
    signedBlindedBlockBytes: Uint8Array,
    signedBlindedBlock: SignedBlindedBeaconBlock,
    fork: ForkPostBellatrix & ForkPreGloas
  ): Promise<void>;
  validateGossipSyncCommittee(
    syncCommitteeBytes: Uint8Array,
    syncCommittee: altair.SyncCommitteeMessage,
    subnet: SubnetID
  ): Promise<GossipValidationResult<void>>;
  validateSyncCommitteeGossipContributionAndProof(
    contributionBytes: Uint8Array,
    signedContributionAndProof: altair.SignedContributionAndProof,
    skipValidationKnownParticipants?: boolean
  ): Promise<GossipValidationResult<{syncCommitteeParticipantIndices: ValidatorIndex[]}>>;
  validateGossipBlobSidecar(
    blobBytes: Uint8Array,
    blobSidecar: deneb.BlobSidecar,
    fork: ForkName,
    subnet: SubnetID
  ): Promise<GossipValidationResult<void>>;
  validateGossipFuluDataColumnSidecar(
    dataColumnBytes: Uint8Array,
    dataColumnSidecar: fulu.DataColumnSidecar,
    gossipSubnet: SubnetID
  ): Promise<GossipValidationResult<void>>;
  validateGossipGloasDataColumnSidecar(
    dataColumnBytes: Uint8Array,
    dataColumnSidecar: gloas.DataColumnSidecar,
    gossipSubnet: SubnetID
  ): Promise<GossipValidationResult<void>>;
  validateGossipPayloadAttestationMessage(
    payloadAttestationBytes: Uint8Array,
    payloadAttestationMessage: gloas.PayloadAttestationMessage
  ): Promise<GossipValidationResult<void>>;
  validateGossipAggregateAndProof(
    aggregateBytes: Uint8Array,
    signedAggregateAndProof: SignedAggregateAndProof,
    fork: ForkName,
    seenTimestampSec: number
  ): Promise<GossipValidationResult<{indexedAttestation: IndexedAttestation}>>;
  validateGossipExecutionPayloadEnvelope(
    envelopeBytes: Uint8Array,
    executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope,
    source: SourceMeta
  ): Promise<GossipValidationResult<void>>;
  validateGossipExecutionPayloadBid(
    bidBytes: Uint8Array,
    signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid,
    fork: ForkName,
    seenTimestampSec: number
  ): Promise<GossipValidationResult<{proposerIndex: ValidatorIndex}>>;
  validateGossipProposerPreferences(
    preferencesBytes: Uint8Array,
    signedProposerPreferences: gloas.SignedProposerPreferences
  ): Promise<GossipValidationResult<void>>;
  validateGossipAttesterSlashing(
    attesterSlashingBytes: Uint8Array,
    attesterSlashing: AttesterSlashing,
    fork: ForkName
  ): Promise<GossipValidationResult<void>>;
  validateGossipProposerSlashing(
    proposerSlashingBytes: Uint8Array,
    proposerSlashing: phase0.ProposerSlashing
  ): Promise<GossipValidationResult<void>>;
  validateGossipVoluntaryExit(
    voluntaryExitBytes: Uint8Array,
    voluntaryExit: phase0.SignedVoluntaryExit
  ): Promise<GossipValidationResult<void>>;
  validateGossipBlsToExecutionChange(
    blsToExecutionChangeBytes: Uint8Array,
    blsToExecutionChange: capella.SignedBLSToExecutionChange
  ): Promise<GossipValidationResult<void>>;
  validateGossipBlock(
    signedBlock: SignedBeaconBlock,
    blockBytes: Uint8Array,
    fork: ForkName,
    seenTimestampSec?: number
  ): Promise<GossipBlockResult>;
  validateApiSyncCommittee(
    syncCommitteeBytes: Uint8Array,
    syncCommittee: altair.SyncCommitteeMessage
  ): Promise<GossipValidationResult<{subnets: number[]}>>;
  validateApiSyncCommitteeContributionAndProof(
    contributionBytes: Uint8Array,
    signedContributionAndProof: altair.SignedContributionAndProof
  ): Promise<GossipValidationResult<void>>;
  validateApiPayloadAttestationMessage(
    payloadAttestationBytes: Uint8Array,
    payloadAttestationMessage: gloas.PayloadAttestationMessage
  ): Promise<GossipValidationResult<void>>;
  validateApiAggregateAndProof(
    aggregateBytes: Uint8Array,
    fork: ForkName,
    signedAggregateAndProof: SignedAggregateAndProof
  ): Promise<GossipValidationResult<{indexedAttestation: IndexedAttestation}>>;
  validateApiExecutionPayloadEnvelope(
    envelopeBytes: Uint8Array,
    executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope,
    seenTimestampSec: number
  ): Promise<GossipValidationResult<void>>;
  validateApiExecutionPayloadBid(
    bidBytes: Uint8Array,
    signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid
  ): Promise<GossipValidationResult<void>>;
  verifyAndObserveBlockProposer(bytes: Uint8Array, block: SignedBeaconBlock, root: RootHex): Promise<void>;
  verifyEnvelopeForPublish(
    bytes: Uint8Array,
    envelope: gloas.SignedExecutionPayloadEnvelope,
    blockRootHex: RootHex
  ): Promise<void>;
  validateApiBlock(blockInput: IBlockInput, opts: VerifyBlocksOpts): Promise<void>;
  verifyBlocks(
    blockInputs: IBlockInput[],
    opts: VerifyBlocksOpts
  ): Promise<{segmentExecStatus: SegmentExecStatus; verifyStateTime: number; verifySignaturesTime: number}>;
  importBlock(
    blockInput: IBlockInput,
    dataAvailabilityStatus: DataAvailabilityStatus,
    opts: ImportBlockOpts
  ): Promise<ImportBlockResult>;
  importExecutionPayload(
    payloadInput: PayloadEnvelopeInput,
    envelopeBytes: Uint8Array,
    dataAvailabilityStatus: DataAvailabilityStatus,
    opts: ImportExecutionPayloadOpts
  ): Promise<{executionOptimistic: boolean}>;
}

export type SSZObjectType =
  | "state"
  | "signedBlock"
  | "block"
  | "attestation"
  | "signedAggregatedAndProof"
  | "syncCommittee"
  | "contributionAndProof";

export type CommonBlockBody = Omit<phase0.BeaconBlockBody, "eth1Data" | "deposits"> &
  Partial<Pick<phase0.BeaconBlockBody, "eth1Data" | "deposits">> &
  Pick<capella.BeaconBlockBody, "blsToExecutionChanges"> &
  Pick<altair.BeaconBlockBody, "syncAggregate">;
