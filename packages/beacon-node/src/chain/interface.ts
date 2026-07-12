import {Type} from "@chainsafe/ssz";
import {BeaconConfig} from "@lodestar/config";
import {IBeaconStateView, PubkeyCache} from "@lodestar/state-transition";
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
} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {IExecutionBuilder, IExecutionEngine} from "../execution/index.js";
import {Metrics} from "../metrics/metrics.js";
import {IClock} from "../util/clock.js";
import {CustodyConfig} from "../util/dataColumns.js";
import {SerializedCache} from "../util/serializedCache.js";
import {BlockRootSlot} from "../util/sszBytes.js";
import {IArchiveStore} from "./archiveStore/interface.js";
import {IBeaconEngine} from "./beaconEngine/index.js";
import {ProposerPreparationData} from "./beaconProposerCache.js";
import {IBlockInput} from "./blocks/blockInput/index.js";
import {ImportBlockOpts, ImportPayloadOpts} from "./blocks/types.js";
import {IBlsVerifier} from "./bls/index.js";
import {ColumnReconstructionTracker} from "./ColumnReconstructionTracker.js";
import {ChainEventEmitter} from "./emitter.js";
import {GetBlobsTracker} from "./GetBlobsTracker.js";
import {LightClientServer} from "./lightClient/index.js";
import {IChainOptions} from "./options.js";
import {AssembledBlockType, BlockAttributes, BlockType, ProduceResult} from "./produceBlock/produceBlockBody.js";
import {ReprocessController} from "./reprocess.js";
import {SeenBlockInput} from "./seenCache/seenGossipBlockInput.js";
import {PayloadEnvelopeInput, SeenPayloadEnvelopeInput} from "./seenCache/seenPayloadEnvelopeInput.js";
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

  /** The initial slot that the chain is started with */
  readonly anchorStateLatestBlockSlot: Slot;

  readonly beaconEngine: IBeaconEngine;
  readonly bls: IBlsVerifier;
  readonly clock: IClock;
  readonly emitter: ChainEventEmitter;
  readonly lightClientServer?: LightClientServer;
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

  validatorSeenAtEpoch(index: ValidatorIndex, epoch: Epoch): boolean;

  /** Return serialized bytes of a persisted checkpoint state */
  getPersistedCheckpointState(checkpoint?: phase0.Checkpoint): Promise<Uint8Array | null>;

  /**
   * Since we can have multiple parallel chains,
   * this methods returns blocks in current chain head according to
   * forkchoice. Works for finalized slots as well
   */
  getCanonicalBlockAtSlot(
    slot: Slot
  ): Promise<{block: SignedBeaconBlock; executionOptimistic: boolean; finalized: boolean} | null>;
  /**
   * Get local serialized block by root (bytes-first), does not fetch from the network
   */
  getSerializedBlockByRoot(
    root: Uint8Array
  ): Promise<{block: Uint8Array; executionOptimistic: boolean; finalized: boolean; slot: Slot} | null>;
  /**
   * Get local block by root, does not fetch from the network
   */
  getBlockByRoot(
    root: RootHex
  ): Promise<{block: SignedBeaconBlock; executionOptimistic: boolean; finalized: boolean} | null>;
  // Engine passthroughs (block DB is engine-owned) — used by p2p handlers / reqresp utils / api.
  getSerializedFinalizedBlockBySlot(slot: Slot): Promise<Uint8Array | null>;
  getCanonicalBlockRootSlotsByRange(
    startSlot: Slot,
    endSlot: Slot
  ): {finalizedSlot: Slot; nonFinalized: BlockRootSlot[]};
  getFinalizedBlockSlotByRoot(root: Uint8Array): Promise<Slot | null>;
  getSerializedFinalizedBlockByParentRoot(parentRoot: Uint8Array): Promise<Uint8Array | null>;
  getBlobSidecars(blockSlot: Slot, blockRootHex: string): Promise<deneb.BlobSidecars | null>;
  getSerializedBlobSidecars(blockSlot: Slot, blockRootHex: string): Promise<Uint8Array | null>;
  getDataColumnSidecars(blockSlot: Slot, blockRootHex: string): Promise<DataColumnSidecar[]>;
  getSerializedDataColumnSidecars(
    blockSlot: Slot,
    blockRootHex: string,
    indices: number[]
  ): Promise<(Uint8Array | undefined)[]>;
  getSerializedExecutionPayloadEnvelope(blockSlot: Slot, blockRoot: Uint8Array): Promise<Uint8Array | null>;
  getSerializedFinalizedExecutionPayloadEnvelope(slot: Slot): Promise<Uint8Array | null>;
  getFullBlockRootSlotsByRange(startSlot: Slot, endSlot: Slot): {finalizedSlot: Slot; nonFinalized: BlockRootSlot[]};
  getExecutionPayloadEnvelope(
    blockSlot: Slot,
    blockRootHex: string
  ): Promise<gloas.SignedExecutionPayloadEnvelope | null>;
  getParentExecutionRequests(parentBlockSlot: Slot, parentBlockRootHex: RootHex): Promise<gloas.ExecutionRequests>;

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
  processChainSegment(
    blocks: IBlockInput[],
    payloadEnvelopes: Map<Slot, PayloadEnvelopeInput> | null,
    opts?: ImportBlockOpts
  ): Promise<void>;

  /** Process execution payload envelope: verify, import to fork choice, and persist to DB */
  processExecutionPayload(payloadInput: PayloadEnvelopeInput, opts?: ImportPayloadOpts): Promise<void>;

  getStatus(): Status;

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
  updateBuilderStatus(clockSlot: Slot): void;

  regenCanAcceptWork(): boolean;
  blsThreadPoolCanAcceptWork(): boolean;
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
