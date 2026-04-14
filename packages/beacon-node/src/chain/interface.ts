import {Type} from "@chainsafe/ssz";
import {BeaconConfig} from "@lodestar/config";
import {CheckpointWithHex, CheckpointWithPayloadStatus, IForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {EpochShuffling, IBeaconStateView, PubkeyCache} from "@lodestar/state-transition";
import {
  BeaconBlock,
  BlindedBeaconBlock,
  DataColumnSidecar,
  Epoch,
  Root,
  RootHex,
  SignedBeaconBlock,
  Slot,
  Status,
  UintNum64,
  ValidatorIndex,
  Wei,
  altair,
  capella,
  deneb,
  gloas,
  phase0,
  rewards,
} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {IExecutionBuilder, IExecutionEngine} from "../execution/index.js";
import {Metrics} from "../metrics/metrics.js";
import {BufferPool} from "../util/bufferPool.js";
import {IClock} from "../util/clock.js";
import {CustodyConfig} from "../util/dataColumns.js";
import {SerializedCache} from "../util/serializedCache.js";
import {IArchiveStore} from "./archiveStore/interface.js";
import {CheckpointBalancesCache} from "./balancesCache.js";
import {BeaconProposerCache, ProposerPreparationData} from "./beaconProposerCache.js";
import {IBlockInput} from "./blocks/blockInput/index.js";
import {ImportBlockOpts, ImportPayloadOpts} from "./blocks/types.js";
import {IBlsVerifier} from "./bls/index.js";
import {ColumnReconstructionTracker} from "./ColumnReconstructionTracker.js";
import {ChainEventEmitter} from "./emitter.js";
import {ForkchoiceCaller} from "./forkChoice/index.js";
import {GetBlobsTracker} from "./GetBlobsTracker.js";
import {LightClientServer} from "./lightClient/index.js";
import {AggregatedAttestationPool} from "./opPools/aggregatedAttestationPool.js";
import {
  AttestationPool,
  DeferredVoluntaryExitPool,
  ExecutionPayloadBidPool,
  OpPool,
  PayloadAttestationPool,
  SyncCommitteeMessagePool,
  SyncContributionAndProofPool,
} from "./opPools/index.js";
import {IChainOptions} from "./options.js";
import {AssembledBlockType, BlockAttributes, BlockType, ProduceResult} from "./produceBlock/produceBlockBody.js";
import {IStateRegenerator, RegenCaller} from "./regen/index.js";
import {ReprocessController} from "./reprocess.js";
import {
  SeenAggregators,
  SeenAttesters,
  SeenBlockProposers,
  SeenContributionAndProof,
  SeenExecutionPayloadBids,
  SeenPayloadAttesters,
  SeenSyncCommitteeMessages,
} from "./seenCache/index.js";
import {SeenAggregatedAttestations} from "./seenCache/seenAggregateAndProof.js";
import {SeenAttestationDatas} from "./seenCache/seenAttestationData.js";
import {SeenBlockAttesters} from "./seenCache/seenBlockAttesters.js";
import {SeenBlockInput} from "./seenCache/seenGossipBlockInput.js";
import {PayloadEnvelopeInput, SeenPayloadEnvelopeInput} from "./seenCache/seenPayloadEnvelopeInput.js";
import {ShufflingCache} from "./shufflingCache.js";
import {ValidatorMonitor} from "./validatorMonitor.js";

export {BlockType, type AssembledBlockType};
export {type ProposerPreparationData};
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
  readonly earliestAvailableSlot: Slot;
  readonly executionEngine: IExecutionEngine;
  readonly executionBuilder?: IExecutionBuilder;
  // Expose config for convenience in modularized functions
  readonly config: BeaconConfig;
  readonly custodyConfig: CustodyConfig;
  readonly logger: Logger;
  readonly metrics: Metrics | null;
  readonly validatorMonitor: ValidatorMonitor | null;
  readonly bufferPool: BufferPool | null;

  /** The initial slot that the chain is started with */
  readonly anchorStateLatestBlockSlot: Slot;

  readonly bls: IBlsVerifier;
  readonly forkChoice: IForkChoice;
  readonly clock: IClock;
  readonly emitter: ChainEventEmitter;
  readonly regen: IStateRegenerator;
  readonly lightClientServer?: LightClientServer;
  readonly reprocessController: ReprocessController;
  readonly pubkeyCache: PubkeyCache;
  readonly archiveStore: IArchiveStore;

  // Ops pool
  readonly attestationPool: AttestationPool;
  readonly aggregatedAttestationPool: AggregatedAttestationPool;
  readonly syncCommitteeMessagePool: SyncCommitteeMessagePool;
  readonly syncContributionAndProofPool: SyncContributionAndProofPool;
  readonly executionPayloadBidPool: ExecutionPayloadBidPool;
  readonly payloadAttestationPool: PayloadAttestationPool;
  readonly opPool: OpPool;
  readonly deferredVoluntaryExitPool: DeferredVoluntaryExitPool;

  // Gossip seen cache
  readonly seenAttesters: SeenAttesters;
  readonly seenAggregators: SeenAggregators;
  readonly seenPayloadAttesters: SeenPayloadAttesters;
  readonly seenAggregatedAttestations: SeenAggregatedAttestations;
  readonly seenExecutionPayloadBids: SeenExecutionPayloadBids;
  readonly seenBlockProposers: SeenBlockProposers;
  readonly seenSyncCommitteeMessages: SeenSyncCommitteeMessages;
  readonly seenContributionAndProof: SeenContributionAndProof;
  readonly seenAttestationDatas: SeenAttestationDatas;
  readonly seenBlockInputCache: SeenBlockInput;
  readonly seenPayloadEnvelopeInputCache: SeenPayloadEnvelopeInput;
  // Seen cache for liveness checks
  readonly seenBlockAttesters: SeenBlockAttesters;

  readonly beaconProposerCache: BeaconProposerCache;
  readonly checkpointBalancesCache: CheckpointBalancesCache;

  readonly blockProductionCache: Map<RootHex, ProduceResult>;

  readonly shufflingCache: ShufflingCache;
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

  validatorSeenAtEpoch(index: ValidatorIndex, epoch: Epoch): boolean;

  getHeadState(): IBeaconStateView;
  getHeadStateAtCurrentEpoch(regenCaller: RegenCaller): Promise<IBeaconStateView>;
  getHeadStateAtEpoch(epoch: Epoch, regenCaller: RegenCaller): Promise<IBeaconStateView>;

  getHistoricalStateBySlot(
    slot: Slot
  ): Promise<{state: Uint8Array; executionOptimistic: boolean; finalized: boolean} | null>;

  /** Returns a local state canonical at `slot` */
  getStateBySlot(
    slot: Slot,
    opts?: StateGetOpts
  ): Promise<{state: IBeaconStateView; executionOptimistic: boolean; finalized: boolean} | null>;
  /** Returns a local state by state root */
  getStateByStateRoot(
    stateRoot: RootHex,
    opts?: StateGetOpts
  ): Promise<{state: IBeaconStateView | Uint8Array; executionOptimistic: boolean; finalized: boolean} | null>;
  /** Return serialized bytes of a persisted checkpoint state */
  getPersistedCheckpointState(checkpoint?: phase0.Checkpoint): Promise<Uint8Array | null>;
  /** Returns a cached state by checkpoint */
  getStateByCheckpoint(
    checkpoint: CheckpointWithHex
  ): {state: IBeaconStateView; executionOptimistic: boolean; finalized: boolean} | null;
  /** Return state bytes by checkpoint */
  getStateOrBytesByCheckpoint(
    checkpoint: CheckpointWithPayloadStatus
  ): Promise<{state: IBeaconStateView | Uint8Array; executionOptimistic: boolean; finalized: boolean} | null>;

  /**
   * Since we can have multiple parallel chains,
   * this methods returns blocks in current chain head according to
   * forkchoice. Works for finalized slots as well
   */
  getCanonicalBlockAtSlot(
    slot: Slot
  ): Promise<{block: SignedBeaconBlock; executionOptimistic: boolean; finalized: boolean} | null>;
  /**
   * Get local block by root, does not fetch from the network
   */
  getSerializedBlockByRoot(
    root: RootHex
  ): Promise<{block: Uint8Array; executionOptimistic: boolean; finalized: boolean; slot: Slot} | null>;
  /**
   * Get local block by root, does not fetch from the network
   */
  getBlockByRoot(
    root: RootHex
  ): Promise<{block: SignedBeaconBlock; executionOptimistic: boolean; finalized: boolean} | null>;
  getBlobSidecars(blockSlot: Slot, blockRootHex: string): Promise<deneb.BlobSidecars | null>;
  getSerializedBlobSidecars(blockSlot: Slot, blockRootHex: string): Promise<Uint8Array | null>;
  getDataColumnSidecars(blockSlot: Slot, blockRootHex: string): Promise<DataColumnSidecar[]>;
  getSerializedDataColumnSidecars(
    blockSlot: Slot,
    blockRootHex: string,
    indices: number[]
  ): Promise<(Uint8Array | undefined)[]>;
  getSerializedExecutionPayloadEnvelope(blockSlot: Slot, blockRootHex: string): Promise<Uint8Array | null>;
  getExecutionPayloadEnvelope(
    blockSlot: Slot,
    blockRootHex: string
  ): Promise<gloas.SignedExecutionPayloadEnvelope | null>;

  produceCommonBlockBody(blockAttributes: BlockAttributes): Promise<CommonBlockBody>;
  produceBlock(blockAttributes: BlockAttributes & {commonBlockBodyPromise: Promise<CommonBlockBody>}): Promise<{
    block: BeaconBlock;
    executionPayloadValue: Wei;
    consensusBlockValue: Wei;
    shouldOverrideBuilder?: boolean;
  }>;
  produceBlindedBlock(blockAttributes: BlockAttributes & {commonBlockBodyPromise: Promise<CommonBlockBody>}): Promise<{
    block: BlindedBeaconBlock;
    executionPayloadValue: Wei;
    consensusBlockValue: Wei;
  }>;

  /** Process a block until complete */
  processBlock(block: IBlockInput, opts?: ImportBlockOpts): Promise<void>;
  /** Process a chain of blocks until complete */
  processChainSegment(blocks: IBlockInput[], opts?: ImportBlockOpts): Promise<void>;

  /** Process execution payload envelope: verify, import to fork choice, and persist to DB */
  processExecutionPayload(payloadInput: PayloadEnvelopeInput, opts?: ImportPayloadOpts): Promise<void>;

  getStatus(): Status;

  recomputeForkChoiceHead(caller: ForkchoiceCaller): ProtoBlock;

  /** When proposerBoostReorg is enabled, this is called at slot n-1 to predict the head block to build on if we are proposing at slot n */
  predictProposerHead(slot: Slot): ProtoBlock;

  /** When proposerBoostReorg is enabled and we are proposing a block, this is called to determine which head block to build on */
  getProposerHead(slot: Slot): ProtoBlock;

  waitForBlock(slot: Slot, root: RootHex): Promise<boolean>;

  updateBeaconProposerData(epoch: Epoch, proposers: ProposerPreparationData[]): Promise<void>;

  persistBlock(data: BeaconBlock | BlindedBeaconBlock, suffix?: string): void;
  persistInvalidStateRoot(
    preState: IBeaconStateView,
    postState: IBeaconStateView,
    block: SignedBeaconBlock
  ): Promise<void>;
  persistInvalidSszValue<T>(type: Type<T>, sszObject: T | Uint8Array, suffix?: string): void;
  persistInvalidSszBytes(type: string, sszBytes: Uint8Array, suffix?: string): void;
  regenStateForAttestationVerification(
    attEpoch: Epoch,
    shufflingDependentRoot: RootHex,
    attHeadBlock: ProtoBlock,
    regenCaller: RegenCaller
  ): Promise<EpochShuffling>;
  updateBuilderStatus(clockSlot: Slot): void;

  regenCanAcceptWork(): boolean;
  blsThreadPoolCanAcceptWork(): boolean;

  getBlockRewards(blockRef: BeaconBlock | BlindedBeaconBlock): Promise<rewards.BlockRewards>;
  getAttestationsRewards(
    epoch: Epoch,
    validatorIds?: (ValidatorIndex | string)[]
  ): Promise<{rewards: rewards.AttestationsRewards; executionOptimistic: boolean; finalized: boolean}>;
  getSyncCommitteeRewards(
    blockRef: BeaconBlock | BlindedBeaconBlock,
    validatorIds?: (ValidatorIndex | string)[]
  ): Promise<rewards.SyncCommitteeRewards>;
}

export type SSZObjectType =
  | "state"
  | "signedBlock"
  | "block"
  | "attestation"
  | "signedAggregatedAndProof"
  | "syncCommittee"
  | "contributionAndProof";

export type CommonBlockBody = phase0.BeaconBlockBody &
  Pick<capella.BeaconBlockBody, "blsToExecutionChanges"> &
  Pick<altair.BeaconBlockBody, "syncAggregate">;
