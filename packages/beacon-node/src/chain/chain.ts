import path from "node:path";
import {type PubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {Type} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {BeaconConfig} from "@lodestar/config";
import {CheckpointWithHex, PayloadStatus} from "@lodestar/fork-choice";
import {LoggerNode} from "@lodestar/logger/node";
import {EFFECTIVE_BALANCE_INCREMENT, type ForkPostFulu, type ForkPostGloas, isForkPostGloas} from "@lodestar/params";
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
  deneb,
  gloas,
  isBlindedBeaconBlock,
  phase0,
  ssz,
  sszTypesFor,
} from "@lodestar/types";
import {Logger, fromHex, pruneSetToMax, toRootHex} from "@lodestar/utils";
import {ProcessShutdownCallback} from "@lodestar/validator";
import {GENESIS_EPOCH, ZERO_HASH} from "../constants/index.js";
import {IBeaconChainDb, IBeaconDb} from "../db/index.js";
import {BLOB_SIDECARS_IN_WRAPPER_INDEX} from "../db/repositories/blobSidecars.js";
import {decodeArchivedEnvelope} from "../db/repositories/index.js";
import {BuilderApiClient} from "../execution/builder/apiClient.js";
import {IExecutionBuilder, IExecutionEngine} from "../execution/index.js";
import {Metrics} from "../metrics/index.js";
import {ClockEvent, IClock} from "../util/clock.js";
import {CustodyConfig, getValidatorsCustodyRequirement} from "../util/dataColumns.js";
import {callInNextEventLoop} from "../util/eventLoop.js";
import {ReconstructMissPolicy, isRebuildMiss, reconstructExecutionPayloadEnvelopes} from "../util/execution.js";
import {isOptimisticBlock} from "../util/forkChoice.js";
import {JobItemQueue} from "../util/queue/itemQueue.js";
import {SerializedCache} from "../util/serializedCache.js";
import {BlockRootSlot, getSlotFromSignedBeaconBlockSerialized} from "../util/sszBytes.js";
import {ArchiveStore} from "./archiveStore/archiveStore.js";
import {BeaconEngineEvent, BeaconEngineEventData} from "./beaconEngine/events.js";
import {IBeaconEngine} from "./beaconEngine/index.js";
import {EngineBootstrap} from "./beaconEngine/initialization.js";
import {IBlockInput, isBlockInputBlobs, isBlockInputColumns} from "./blocks/blockInput/index.js";
import {BlockProcessor, ImportBlockOpts} from "./blocks/index.js";
import {PayloadEnvelopeInputSource} from "./blocks/payloadEnvelopeInput/index.js";
import {PayloadEnvelopeProcessor} from "./blocks/payloadEnvelopeProcessor.js";
import {ImportPayloadOpts, ProcessBlocksResult} from "./blocks/types.js";
import {persistInvalidSszObject} from "./blocks/utils/persistInvalidSszObject.js";
import {persistBlockInput} from "./blocks/writeBlockInputToDb.js";
import {persistPayloadEnvelopeInput} from "./blocks/writePayloadEnvelopeInputToDb.js";
import {BlsSingleThreadVerifier, IBlsVerifier} from "./bls/index.js";
import {ColumnReconstructionTracker} from "./ColumnReconstructionTracker.js";
import {ChainView} from "./chainView/chainView.js";
import {ChainViewBlock, ChainViewUpdate} from "./chainView/interface.js";
import {ChainEvent, ChainEventEmitter} from "./emitter.js";
import {GetBlobsTracker} from "./GetBlobsTracker.js";
import {IBeaconChain, ProposerPreparationData} from "./interface.js";
import {LightClientServer} from "./lightClient/index.js";
import {IChainOptions} from "./options.js";
import {PrepareNextSlotScheduler} from "./prepareNextSlot.js";
import {ProduceResult} from "./produceBlock/index.js";
import {ReprocessController} from "./reprocess.js";
import {PayloadEnvelopeInput, SeenPayloadEnvelopeInput} from "./seenCache/index.js";
import {SeenBlockInput} from "./seenCache/seenGossipBlockInput.js";
import {checkpointToDatastoreKey} from "./stateCache/datastore/db.js";
import {CPStateDatastore} from "./stateCache/datastore/types.js";

/**
 * The maximum number of cached produced results to keep in memory.
 *
 * Arbitrary constant. Blobs and payloads should be consumed immediately in the same slot
 * they are produced. A value of 1 would probably be sufficient. However it's sensible to
 * allow some margin if the node overloads.
 */
const DEFAULT_MAX_CACHED_PRODUCED_RESULTS = 4;

/**
 * The maximum number of pending unfinalized block writes to the database before backpressure is applied.
 * Write queue entries hold references to block inputs, keeping them in memory even after cache eviction.
 * This is especially important for supernodes which store all 128 columns per block — each pending
 * write can hold significant memory. Keep moderate to avoid OOM during sync.
 */
const DEFAULT_MAX_PENDING_UNFINALIZED_BLOCK_WRITES = 16;

/**
 * The maximum number of pending unfinalized payload envelope writes to the database before backpressure is applied.
 * Payload envelope write queue entries hold references to payload inputs (including columns),
 * keeping them in memory. Keep moderate to avoid OOM during sync.
 */
const DEFAULT_MAX_PENDING_UNFINALIZED_PAYLOAD_ENVELOPE_WRITES = 16;

export type BeaconChainModules = {
  config: BeaconConfig;
  pubkeyCache: PubkeyCache;
  db: IBeaconDb;
  dbName: string;
  dataDir: string;
  dataColumnDir?: string;
  logger: Logger;
  processShutdownCallback: ProcessShutdownCallback;
  metrics: Metrics | null;
  executionEngine: IExecutionEngine;
  executionBuilder?: IExecutionBuilder;
  beaconEngine: IBeaconEngine;
  builderApiClient: BuilderApiClient;
  anchor: EngineBootstrap;
  abortController: AbortController;
  clock: IClock;
  emitter: ChainEventEmitter;
  cpStateDatastore: CPStateDatastore;
  custodyConfig: CustodyConfig;
  lightClientServer?: LightClientServer;
};

const EVENTSTREAM_EMIT_RECENT_EXECUTION_PAYLOAD_SLOTS = 64;

export class BeaconChain implements IBeaconChain {
  readonly genesisTime: UintNum64;
  readonly genesisValidatorsRoot: Root;
  readonly beaconEngine: IBeaconEngine;
  readonly executionEngine: IExecutionEngine;
  readonly executionBuilder?: IExecutionBuilder;

  readonly builderApiClient: BuilderApiClient;
  // Expose config for convenience in modularized functions
  readonly config: BeaconConfig;
  readonly custodyConfig: CustodyConfig;
  readonly logger: Logger;
  readonly metrics: Metrics | null;

  readonly anchorStateLatestBlockSlot: Slot;

  // TODO - beacon engine: retained only for pre-Gloas blob and data-column sidecar proposer signatures.
  readonly bls: IBlsVerifier;
  private readonly chainView: ChainView;
  readonly clock: IClock;
  readonly emitter: ChainEventEmitter;
  readonly lightClientServer?: LightClientServer;
  readonly reprocessController: ReprocessController;
  readonly archiveStore: ArchiveStore;
  readonly unfinalizedBlockWrites: JobItemQueue<[IBlockInput], void>;
  readonly unfinalizedPayloadEnvelopeWrites: JobItemQueue<[PayloadEnvelopeInput], void>;

  // Op pools are engine-internal (pruned + read/written via the engine); no facade getters.

  // Gossip seen caches are engine-internal (pruned + read via the engine); no facade getters.
  readonly seenBlockInputCache: SeenBlockInput;
  readonly seenPayloadEnvelopeInputCache: SeenPayloadEnvelopeInput;

  // Global state caches
  // TODO - beacon engine: should this be moved to BeaconEngine?
  readonly pubkeyCache: PubkeyCache;

  /**
   * Cache produced results (ExecutionPayload, DA Data) from the local execution so that we can send
   * and get signed/published blinded versions which beacon node can
   * assemble into full blocks before publishing to the network.
   */
  readonly blockProductionCache = new Map<RootHex, ProduceResult>();

  readonly blacklistedBlocks: Map<RootHex, Slot | null>;

  readonly serializedCache: SerializedCache;

  readonly getBlobsTracker: GetBlobsTracker;
  readonly columnReconstructionTracker: ColumnReconstructionTracker;

  readonly opts: IChainOptions;

  protected readonly blockProcessor: BlockProcessor;
  protected readonly payloadEnvelopeProcessor: PayloadEnvelopeProcessor;
  // Facade reads blocks and envelopes and owns DA + light-client + backfill stores.
  protected readonly db: IBeaconChainDb;
  // this is only available if nHistoricalStates is enabled
  private readonly cpStateDatastore?: CPStateDatastore;
  private readonly abortController: AbortController;
  private processShutdownCallback: ProcessShutdownCallback;
  private _earliestAvailableSlot: Slot;

  get earliestAvailableSlot(): Slot {
    return this._earliestAvailableSlot;
  }

  set earliestAvailableSlot(slot: Slot) {
    if (this._earliestAvailableSlot !== slot) {
      this._earliestAvailableSlot = slot;
      this.emitter.emit(ChainEvent.updateStatus);
    }
  }

  constructor(opts: IChainOptions, modules: BeaconChainModules) {
    const {
      config,
      pubkeyCache,
      db,
      dbName,
      dataDir,
      dataColumnDir,
      logger,
      processShutdownCallback,
      metrics,
      executionEngine,
      executionBuilder,
      beaconEngine,
      anchor,
      abortController,
      clock,
      emitter,
      cpStateDatastore,
      custodyConfig,
      lightClientServer,
    } = modules;
    this.opts = opts;
    this.config = config;
    this.db = db;
    this.logger = logger;
    this.processShutdownCallback = processShutdownCallback;
    this.metrics = metrics;
    this.bls = new BlsSingleThreadVerifier({metrics});
    this.genesisTime = anchor.genesisTime;
    this.anchorStateLatestBlockSlot = anchor.latestBlockSlot;
    this.genesisValidatorsRoot = anchor.genesisValidatorsRoot;
    this.executionEngine = executionEngine;
    this.executionBuilder = executionBuilder;
    this.abortController = abortController;
    const signal = abortController.signal;
    this.cpStateDatastore = cpStateDatastore;
    this.custodyConfig = custodyConfig;
    this.serializedCache = new SerializedCache();
    this.seenBlockInputCache = new SeenBlockInput({
      config,
      custodyConfig: this.custodyConfig,
      clock,
      chainEvents: emitter,
      signal,
      serializedCache: this.serializedCache,
      metrics,
      logger,
    });
    this.lightClientServer = lightClientServer;
    this.beaconEngine = beaconEngine;
    // TODO - beacon engine: replace shared builder HTTP client when the worker transport is introduced.
    this.builderApiClient = modules.builderApiClient;
    this.chainView = new ChainView(beaconEngine.getChainViewSnapshot(), logger);
    beaconEngine.events.on(BeaconEngineEvent.chainViewUpdated, this.onChainViewUpdated);
    beaconEngine.events.on(BeaconEngineEvent.executionPayloadImported, this.onExecutionPayloadImported);

    this.blacklistedBlocks = new Map((opts.blacklistedBlocks ?? []).map((hex) => [hex, null]));

    this._earliestAvailableSlot = anchor.slot;

    // Global cache of validators pubkey/index mapping
    this.pubkeyCache = pubkeyCache;

    const {checkpoint} = anchor;

    this.reprocessController = new ReprocessController(this.metrics);

    this.blockProcessor = new BlockProcessor(this, metrics, opts, signal);
    this.payloadEnvelopeProcessor = new PayloadEnvelopeProcessor(this, metrics, signal);

    this.seenPayloadEnvelopeInputCache = new SeenPayloadEnvelopeInput({
      config,
      clock,
      chainView: this,
      chainEvents: emitter,
      signal,
      serializedCache: this.serializedCache,
      db: this.db,
      seenBlockInputCache: this.seenBlockInputCache,
      custodyConfig: this.custodyConfig,
      metrics,
      logger,
    });
    const anchorBlockSlot = anchor.latestBlockSlot;
    if (anchor.gloasAnchor !== null) {
      const anchorBid = anchor.gloasAnchor.bid;
      this.seenPayloadEnvelopeInputCache.addFromBid({
        blockRootHex: toRootHex(checkpoint.root),
        slot: anchorBlockSlot,
        forkName: anchor.gloasAnchor.fork,
        proposerIndex: anchor.gloasAnchor.proposerIndex,
        bid: anchorBid,
        sampledColumns: this.custodyConfig.sampledColumns,
        custodyColumns: this.custodyConfig.custodyColumns,
        seenTimestampSec: Date.now() / 1000,
        source: PayloadEnvelopeInputSource.anchorState,
      });
    }

    this.clock = clock;
    this.emitter = emitter;

    this.getBlobsTracker = new GetBlobsTracker({
      logger,
      executionEngine: this.executionEngine,
      emitter,
      metrics,
      config,
    });
    this.columnReconstructionTracker = new ColumnReconstructionTracker({
      logger,
      emitter,
      metrics,
      config,
    });

    this.archiveStore = new ArchiveStore(
      {db, chain: this, logger: logger as LoggerNode, metrics},
      {
        ...opts,
        dbName,
        dataColumnDir: dataColumnDir ?? path.join(dataDir, "data_columns"),
        anchorState: {finalizedCheckpoint: anchor.finalizedCheckpoint},
      },
      signal
    );

    this.unfinalizedBlockWrites = new JobItemQueue(
      persistBlockInput.bind(this),
      {
        maxLength: DEFAULT_MAX_PENDING_UNFINALIZED_BLOCK_WRITES,
        signal,
      },
      metrics?.unfinalizedBlockWritesQueue
    );

    this.unfinalizedPayloadEnvelopeWrites = new JobItemQueue(
      persistPayloadEnvelopeInput.bind(this),
      {
        maxLength: DEFAULT_MAX_PENDING_UNFINALIZED_PAYLOAD_ENVELOPE_WRITES,
        signal,
      },
      metrics?.unfinalizedPayloadEnvelopeWritesQueue
    );

    // always run PrepareNextSlotScheduler except for fork_choice spec tests
    if (!opts?.disablePrepareNextSlot) {
      new PrepareNextSlotScheduler(this, this.config, metrics, this.logger, signal);
    }

    if (metrics) {
      metrics.clockSlot.addCollect(() => this.onScrapeMetrics(metrics));
    }

    // Event handlers. emitter is created internally and dropped on close(). Not need to .removeListener()
    clock.addListener(ClockEvent.slot, this.onClockSlot.bind(this));
    clock.addListener(ClockEvent.epoch, this.onClockEpoch.bind(this));
    emitter.addListener(ChainEvent.forkChoiceFinalized, this.onForkChoiceFinalized.bind(this));
    emitter.addListener(ChainEvent.forkChoiceJustified, this.onForkChoiceJustified.bind(this));
  }

  async init(): Promise<void> {
    await this.archiveStore.init();
    await this.loadFromDisk();
  }

  async close(): Promise<void> {
    // Engine owns teardown of its resources (historical-state regen + BLS pool).
    await this.beaconEngine.close();
    await this.bls.close();
    this.beaconEngine.events.off(BeaconEngineEvent.chainViewUpdated, this.onChainViewUpdated);
    this.beaconEngine.events.off(BeaconEngineEvent.executionPayloadImported, this.onExecutionPayloadImported);

    // Since we don't persist unfinalized fork-choice,
    // we can abort any ongoing unfinalized block writes.
    // TODO: persist fork choice to disk and allow unfinalized block writes to complete.
    this.unfinalizedBlockWrites.dropAllJobs();
    this.unfinalizedPayloadEnvelopeWrites.dropAllJobs();

    this.abortController.abort();
  }

  pruneChainView(finalized: CheckpointWithHex): void {
    this.chainView.prune(finalized);
  }

  getHead(): ChainViewBlock {
    return this.chainView.getHead();
  }

  getHeadRoot(): RootHex {
    return this.chainView.getHeadRoot();
  }

  getFinalizedCheckpoint(): CheckpointWithHex {
    return this.chainView.getFinalizedCheckpoint();
  }

  getJustifiedCheckpoint(): CheckpointWithHex {
    return this.chainView.getJustifiedCheckpoint();
  }

  getFinalizedBlock(): ChainViewBlock {
    return this.chainView.getFinalizedBlock();
  }

  getJustifiedBlock(): ChainViewBlock {
    return this.chainView.getJustifiedBlock();
  }

  hasBlock(root: Root): boolean {
    return this.chainView.hasBlock(root);
  }

  hasBlockHex(root: RootHex): boolean {
    return this.chainView.hasBlockHex(root);
  }

  hasBlockHexUnsafe(root: RootHex): boolean {
    return this.chainView.hasBlockHexUnsafe(root);
  }

  hasPayloadHexUnsafe(root: RootHex): boolean {
    return this.chainView.hasPayloadHexUnsafe(root);
  }

  getBlockDefaultStatus(root: Root): ChainViewBlock | null {
    return this.chainView.getBlockDefaultStatus(root);
  }

  getBlockHexDefaultStatus(root: RootHex): ChainViewBlock | null {
    return this.chainView.getBlockHexDefaultStatus(root);
  }

  getBlockHex(root: RootHex, status: PayloadStatus): ChainViewBlock | null {
    return this.chainView.getBlockHex(root, status);
  }

  getBlockHexAndBlockHash(root: RootHex, hash: RootHex): ChainViewBlock | null {
    return this.chainView.getBlockHexAndBlockHash(root, hash);
  }

  getCanonicalProtoBlockAtSlot(slot: Slot): ChainViewBlock | null {
    return this.chainView.getCanonicalProtoBlockAtSlot(slot);
  }

  getCanonicalBlockClosestLteSlot(slot: Slot): ChainViewBlock | null {
    return this.chainView.getCanonicalBlockClosestLteSlot(slot);
  }

  getCanonicalBlockByRoot(root: Root): ChainViewBlock | null {
    return this.chainView.getCanonicalBlockByRoot(root);
  }

  getBlockSummariesAtSlot(slot: Slot): ChainViewBlock[] {
    return this.chainView.getBlockSummariesAtSlot(slot);
  }

  getBlockSummariesByParentRoot(root: RootHex): ChainViewBlock[] {
    return this.chainView.getBlockSummariesByParentRoot(root);
  }

  isDescendant(
    root: RootHex,
    status: PayloadStatus,
    descendantRoot: RootHex,
    descendantStatus: PayloadStatus
  ): boolean {
    return this.chainView.isDescendant(root, status, descendantRoot, descendantStatus);
  }

  getAllAncestorBlocks(root: RootHex, status: PayloadStatus): ChainViewBlock[] {
    return this.chainView.getAllAncestorBlocks(root, status);
  }

  seenBlock(blockRoot: RootHex): boolean {
    return this.seenBlockInputCache.hasBlock(blockRoot) || this.hasBlockHexUnsafe(blockRoot);
  }

  seenPayloadEnvelope(blockRoot: RootHex): boolean {
    return this.seenPayloadEnvelopeInputCache.hasPayload(blockRoot) || this.hasPayloadHexUnsafe(blockRoot);
  }

  regenCanAcceptWork(): boolean {
    return this.beaconEngine.regenCanAcceptWork();
  }

  blsThreadPoolCanAcceptWork(): boolean {
    // Gossip backpressure reflects the engine's internal BLS pool (the binding's pool under native).
    return this.beaconEngine.blsCanAcceptWork();
  }

  validatorSeenAtEpoch(index: ValidatorIndex, epoch: Epoch): boolean {
    // Caller must check that epoch is not older that current epoch - 1
    // else the caches for that epoch may already be pruned.
    // All liveness caches (seenBlockAttesters + gossip caches) are engine-internal.
    return this.beaconEngine.validatorSeenAtEpoch(index, epoch);
  }

  /** Populate in-memory caches with persisted data. Call at least once on startup */
  async loadFromDisk(): Promise<void> {
    await this.beaconEngine.initRegen();
    await this.beaconEngine.loadOpPoolFromDisk();
    await this.beaconEngine.loadHistoricalStateRegen();
  }

  /** Persist in-memory data to the DB. Call at least once before stopping the process */
  async persistToDisk(): Promise<void> {
    await this.archiveStore.persistToDisk();
    await this.beaconEngine.persistOpPoolToDisk();
  }

  async getPersistedCheckpointState(checkpoint?: phase0.Checkpoint): Promise<Uint8Array | null> {
    if (!this.cpStateDatastore) {
      throw new Error("n-historical-state flag is not enabled");
    }

    if (checkpoint == null) {
      // return the last safe checkpoint state by default
      return this.cpStateDatastore.readLatestSafe();
    }

    // TODO GLOAS: Need to revisit the design of this api. Currently we just retrieve FULL state of the checkpoint for backwards compatibility.
    // because pre-gloas we always store FULL checkpoint state.
    const persistedKey = checkpointToDatastoreKey(checkpoint);
    return this.cpStateDatastore.read(persistedKey);
  }

  async getCanonicalBlockAtSlot(
    slot: Slot
  ): Promise<{block: SignedBeaconBlock; executionOptimistic: boolean; finalized: boolean} | null> {
    const finalizedBlock = this.getFinalizedBlock();
    if (slot > finalizedBlock.slot) {
      // Unfinalized slot, attempt to find in fork-choice
      const block = this.getCanonicalProtoBlockAtSlot(slot);
      if (block) {
        // Block found in fork-choice.
        // It may be in the block input cache, awaiting full DA reconstruction, check there first
        // Otherwise (most likely), read the hot db (falling back to cold on an archive race)
        const blockInput = this.seenBlockInputCache.get(block.blockRoot);
        if (blockInput?.hasBlock()) {
          return {block: blockInput.getBlock(), executionOptimistic: isOptimisticBlock(block), finalized: false};
        }
        const res = await this.readStoredBlockByRoot(fromHex(block.blockRoot));
        if (res) {
          return {
            block: this.config.getForkTypes(res.slot).SignedBeaconBlock.deserialize(res.bytes),
            executionOptimistic: isOptimisticBlock(block),
            finalized: res.finalized,
          };
        }
      }
      // A non-finalized slot expected to be found in the hot db, could be archived during
      // this function runtime, so if not found, fallback to the cold db (by slot)
    }

    const bytes = await this.db.blockArchive.getBinary(slot);
    return (
      bytes && {
        block: this.config.getForkTypes(slot).SignedBeaconBlock.deserialize(bytes),
        executionOptimistic: false,
        finalized: true,
      }
    );
  }

  async getBlockByRoot(
    root: string
  ): Promise<{block: SignedBeaconBlock; executionOptimistic: boolean; finalized: boolean} | null> {
    const protoBlock = this.getBlockHexDefaultStatus(root);
    if (protoBlock) {
      // Block found in fork-choice.
      // It may be in the block input cache, awaiting full DA reconstruction, check there first
      // Otherwise (most likely), read the hot db (falling back to cold on an archive race)
      const blockInput = this.seenBlockInputCache.get(protoBlock.blockRoot);
      if (blockInput?.hasBlock()) {
        return {block: blockInput.getBlock(), executionOptimistic: isOptimisticBlock(protoBlock), finalized: false};
      }
    }

    const res = await this.readStoredBlockByRoot(fromHex(root));
    return (
      res && {
        block: this.config.getForkTypes(res.slot).SignedBeaconBlock.deserialize(res.bytes),
        executionOptimistic: protoBlock != null && isOptimisticBlock(protoBlock),
        finalized: res.finalized,
      }
    );
  }

  async getSerializedBlockByRoot(
    root: Uint8Array
  ): Promise<{block: Uint8Array; executionOptimistic: boolean; finalized: boolean; slot: Slot} | null> {
    // TODO - beacon engine: make a separate call, need to be lightweight
    const protoBlock = this.getBlockHexDefaultStatus(toRootHex(root));
    if (protoBlock) {
      // Block found in fork-choice.
      // It may be in the block input cache, awaiting full DA reconstruction, check there first
      // Otherwise (most likely), read the hot db (falling back to cold on an archive race)
      const blockInput = this.seenBlockInputCache.get(protoBlock.blockRoot);
      if (blockInput?.hasBlock()) {
        const signedBlock = blockInput.getBlock();
        return {
          block:
            this.serializedCache.get(signedBlock) ??
            sszTypesFor(blockInput.forkName).SignedBeaconBlock.serialize(signedBlock),
          executionOptimistic: isOptimisticBlock(protoBlock),
          finalized: false,
          slot: blockInput.slot,
        };
      }
    }

    const res = await this.readStoredBlockByRoot(root);
    return (
      res && {
        block: res.bytes,
        executionOptimistic: protoBlock != null && isOptimisticBlock(protoBlock),
        finalized: res.finalized,
        slot: res.slot,
      }
    );
  }

  private async readStoredBlockByRoot(root: Root): Promise<{bytes: Uint8Array; slot: Slot; finalized: boolean} | null> {
    const hot = await this.db.block.getBinary(root);
    if (hot) {
      const slot = getSlotFromSignedBeaconBlockSerialized(hot);
      if (slot === null) throw Error(`Invalid block data stored in DB for root: ${toRootHex(root)}`);
      return {bytes: hot, slot, finalized: false};
    }
    const cold = await this.db.blockArchive.getBinaryEntryByRoot(root);
    return cold && {bytes: cold.value, slot: cold.key, finalized: true};
  }

  getCanonicalBlockRootSlotsByRange(
    startSlot: Slot,
    endSlot: Slot
  ): {finalizedSlot: Slot; nonFinalized: BlockRootSlot[]} {
    return this.chainView.getCanonicalBlockRootSlotsByRange(startSlot, endSlot);
  }

  async getSerializedFinalizedBlockByParentRoot(parentRoot: Uint8Array): Promise<Uint8Array | null> {
    const slot = await this.db.blockArchive.getSlotByParentRoot(parentRoot);
    return slot !== null ? this.db.blockArchive.getBinary(slot) : null;
  }

  async getBlobSidecars(blockSlot: Slot, blockRootHex: string): Promise<deneb.BlobSidecars | null> {
    const blockInput = this.seenBlockInputCache.get(blockRootHex);
    if (blockInput) {
      if (!isBlockInputBlobs(blockInput)) {
        throw new Error(`Expected block input to have blobs: slot=${blockSlot} root=${blockRootHex}`);
      }
      if (!blockInput.hasAllData()) {
        return null;
      }
      return blockInput.getBlobs();
    }
    const unfinalizedBlobSidecars = (await this.db.blobSidecars.get(fromHex(blockRootHex)))?.blobSidecars ?? null;
    if (unfinalizedBlobSidecars) {
      return unfinalizedBlobSidecars;
    }
    return (await this.db.blobSidecarsArchive.get(blockSlot))?.blobSidecars ?? null;
  }

  async getSerializedBlobSidecars(blockSlot: Slot, blockRootHex: string): Promise<Uint8Array | null> {
    const blockInput = this.seenBlockInputCache.get(blockRootHex);
    if (blockInput) {
      if (!isBlockInputBlobs(blockInput)) {
        throw new Error(`Expected block input to have blobs: slot=${blockSlot} root=${blockRootHex}`);
      }
      if (!blockInput.hasAllData()) {
        return null;
      }
      return ssz.deneb.BlobSidecars.serialize(blockInput.getBlobs());
    }
    const unfinalizedBlobSidecarsWrapper = await this.db.blobSidecars.getBinary(fromHex(blockRootHex));
    if (unfinalizedBlobSidecarsWrapper) {
      return unfinalizedBlobSidecarsWrapper.slice(BLOB_SIDECARS_IN_WRAPPER_INDEX);
    }
    const finalizedBlobSidecarsWrapper = await this.db.blobSidecarsArchive.getBinary(blockSlot);
    if (finalizedBlobSidecarsWrapper) {
      return finalizedBlobSidecarsWrapper.slice(BLOB_SIDECARS_IN_WRAPPER_INDEX);
    }
    return null;
  }

  async getSerializedExecutionPayloadEnvelope(blockSlot: Slot, blockRootHex: string): Promise<Uint8Array | null> {
    const [bytes] = await this.getSerializedExecutionPayloadEnvelopes([{blockSlot, blockRootHex}]);
    return bytes;
  }

  /**
   * Batch variant: archived header envelopes are rebuilt 32 per EL round-trip. Aligned with `requests`.
   * An archived envelope that cannot be rebuilt (EL-unavailable body or body root mismatch) is not the
   * same as an unknown one: `"throw"` surfaces it, `"omit"` returns null for that entry, for
   * peer-facing paths where the spec allows omission.
   */
  async getSerializedExecutionPayloadEnvelopes(
    requests: {blockSlot: Slot; blockRootHex: RootHex}[],
    onMiss: ReconstructMissPolicy = "throw"
  ): Promise<(Uint8Array | null)[]> {
    const out: (Uint8Array | null)[] = new Array(requests.length).fill(null);
    const headerEnvelopes: gloas.SignedExecutionPayloadHeaderEnvelope[] = [];
    const headerEnvelopeIdxs: number[] = [];

    for (let i = 0; i < requests.length; i++) {
      const {blockSlot, blockRootHex} = requests[i];

      const payloadInput = this.seenPayloadEnvelopeInputCache.get(blockRootHex);
      if (payloadInput?.hasPayloadEnvelope()) {
        const envelope = payloadInput.getPayloadEnvelope();
        out[i] = this.serializedCache.get(envelope) ?? ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope);
        continue;
      }

      const hot = await this.db.executionPayloadEnvelope.getBinary(fromHex(blockRootHex));
      if (hot !== null) {
        out[i] = hot;
        continue;
      }

      const archivedBytes = await this.db.executionPayloadEnvelopeArchive.getBinary(blockSlot);
      if (archivedBytes === null) continue;

      const archived = decodeArchivedEnvelope(archivedBytes);
      if (archived.envelopeBytes !== undefined) {
        out[i] = archived.envelopeBytes;
        continue;
      }
      headerEnvelopes.push(archived.headerEnvelope);
      headerEnvelopeIdxs.push(i);
    }

    if (headerEnvelopes.length > 0) {
      const rebuilt = await reconstructExecutionPayloadEnvelopes(this.executionEngine, this.metrics, headerEnvelopes);
      for (let j = 0; j < rebuilt.length; j++) {
        const result = rebuilt[j];
        if (isRebuildMiss(result)) {
          if (onMiss === "throw") throw result.error;
          this.logger.debug(
            result.reason === "mismatch"
              ? "Archived envelope failed body root check against EL bodies"
              : "EL cannot serve bodies for archived envelope, omitting",
            {slot: result.slot},
            result.error
          );
          continue;
        }
        out[headerEnvelopeIdxs[j]] = ssz.gloas.SignedExecutionPayloadEnvelope.serialize(result);
      }
    }

    return out;
  }

  /** Engine passthrough: thin ByRange serving refs (fork choice read engine-side). */
  getFullBlockRootSlotsByRange(startSlot: Slot, endSlot: Slot): {finalizedSlot: Slot; nonFinalized: BlockRootSlot[]} {
    return this.chainView.getFullBlockRootSlotsByRange(startSlot, endSlot);
  }

  async getExecutionPayloadEnvelope(
    blockSlot: Slot,
    blockRootHex: string
  ): Promise<gloas.SignedExecutionPayloadEnvelope | null> {
    const payloadInput = this.seenPayloadEnvelopeInputCache.get(blockRootHex);
    if (payloadInput?.hasPayloadEnvelope()) {
      return payloadInput.getPayloadEnvelope();
    }

    const hot = await this.db.executionPayloadEnvelope.get(fromHex(blockRootHex));
    if (hot !== null) return hot;

    const archivedBytes = await this.db.executionPayloadEnvelopeArchive.getBinary(blockSlot);
    if (archivedBytes === null) return null;
    const archived = decodeArchivedEnvelope(archivedBytes);
    if (archived.envelopeBytes !== undefined) {
      return ssz.gloas.SignedExecutionPayloadEnvelope.deserialize(archived.envelopeBytes);
    }
    const [result] = await reconstructExecutionPayloadEnvelopes(this.executionEngine, this.metrics, [
      archived.headerEnvelope,
    ]);
    if (isRebuildMiss(result)) throw result.error;
    return result;
  }

  // [beacon-engine] moved: parent requests are read by BeaconEngine.getParentExecutionRequests.
  // On unstable merges, sync production request lookup there; retain envelope getters here.
  // async getParentExecutionRequests(
  //   parentBlockSlot: Slot,
  //   parentBlockRootHex: RootHex
  // ): Promise<gloas.ExecutionRequests> {
  //   // at the fork boundary, parent is pre-gloas
  //   if (!isForkPostGloas(this.config.getForkName(parentBlockSlot))) {
  //     return ssz.gloas.ExecutionRequests.defaultValue();
  //   }
  //   const envelope = await this.getExecutionPayloadEnvelope(parentBlockSlot, parentBlockRootHex);
  //   if (envelope === null) {
  //     throw Error(`Parent execution payload envelope not found slot=${parentBlockSlot}, root=${parentBlockRootHex}`);
  //   }
  //   return envelope.message.executionRequests;
  // }
  //

  async getDataColumnSidecars(blockSlot: Slot, blockRootHex: string): Promise<DataColumnSidecar[]> {
    const fork = this.config.getForkName(blockSlot);
    const sidecarsByIndex = new Map<number, DataColumnSidecar>();

    if (isForkPostGloas(fork)) {
      // After gloas, columns are tracked in PayloadEnvelopeInput
      const payloadInput = this.seenPayloadEnvelopeInputCache.get(blockRootHex);
      if (payloadInput) {
        for (const sidecar of payloadInput.getAllColumns()) {
          sidecarsByIndex.set(sidecar.index, sidecar);
        }
      }
    } else {
      // Before gloas, columns are tracked in BlockInput
      const blockInput = this.seenBlockInputCache.get(blockRootHex);
      if (blockInput) {
        if (!isBlockInputColumns(blockInput)) {
          throw new Error(`Expected block input to have columns: slot=${blockSlot} root=${blockRootHex}`);
        }
        for (const sidecar of blockInput.getAllColumns()) {
          sidecarsByIndex.set(sidecar.index, sidecar);
        }
      }
    }

    for (const sidecar of await this.db.dataColumns.getAll({slot: blockSlot, blockRoot: blockRootHex})) {
      if (!sidecarsByIndex.has(sidecar.index)) sidecarsByIndex.set(sidecar.index, sidecar);
    }

    return [...sidecarsByIndex.values()].sort((a, b) => a.index - b.index);
  }

  async getSerializedDataColumnSidecars(
    blockSlot: Slot,
    blockRootHex: string,
    indices: number[]
  ): Promise<(Uint8Array | undefined)[]> {
    const fork = this.config.getForkName(blockSlot);
    const dataColumnSidecars: (Uint8Array | undefined)[] = indices.map(() => undefined);

    if (isForkPostGloas(fork)) {
      // After gloas, columns are tracked in PayloadEnvelopeInput
      const payloadInput = this.seenPayloadEnvelopeInputCache.get(blockRootHex);
      if (payloadInput) {
        for (let i = 0; i < indices.length; i++) {
          const index = indices[i];
          const sidecar = payloadInput.getColumn(index);
          if (!sidecar) {
            continue;
          }
          const serialized = this.serializedCache.get(sidecar);
          if (serialized) {
            dataColumnSidecars[i] = serialized;
          } else {
            dataColumnSidecars[i] = sszTypesFor(fork as ForkPostGloas).DataColumnSidecar.serialize(sidecar);
          }
        }
      }
    } else {
      // Before gloas, columns are tracked in BlockInput
      const blockInput = this.seenBlockInputCache.get(blockRootHex);
      if (blockInput) {
        if (!isBlockInputColumns(blockInput)) {
          throw new Error(`Expected block input to have columns: slot=${blockSlot} root=${blockRootHex}`);
        }
        for (let i = 0; i < indices.length; i++) {
          const index = indices[i];
          const sidecar = blockInput.getColumn(index);
          if (!sidecar) {
            continue;
          }
          const serialized = this.serializedCache.get(sidecar);
          if (serialized) {
            dataColumnSidecars[i] = serialized;
          } else {
            dataColumnSidecars[i] = sszTypesFor(blockInput.forkName as ForkPostFulu).DataColumnSidecar.serialize(
              sidecar
            );
          }
        }
      }
    }

    const missingPositions = dataColumnSidecars
      .map((sidecar, position) => (sidecar === undefined ? position : -1))
      .filter((position) => position !== -1);

    if (missingPositions.length > 0) {
      const persistedSidecars = await this.db.dataColumns.getManyBinary(
        {slot: blockSlot, blockRoot: blockRootHex},
        missingPositions.map((position) => indices[position])
      );
      for (let i = 0; i < missingPositions.length; i++) {
        const sidecar = persistedSidecars[i];
        if (sidecar !== undefined) {
          dataColumnSidecars[missingPositions[i]] = sidecar;
        }
      }
    }

    return dataColumnSidecars;
  }

  // [beacon-engine] moved: produceCommonBlockBody, produceBlock, produceBlindedBlock, and
  // produceBlockWrapper now live in packages/beacon-node/src/chain/beaconEngine/produceBlock.ts.
  // On unstable merges, apply changes to those methods there; the API calls the engine directly.

  async processBlock(block: IBlockInput, opts?: ImportBlockOpts): Promise<void> {
    await this.blockProcessor.processBlocksJob([block], null, opts);
  }

  async processChainSegment(
    blocks: IBlockInput[],
    payloadEnvelopes: Map<Slot, PayloadEnvelopeInput> | null,
    opts?: ImportBlockOpts
  ): Promise<ProcessBlocksResult> {
    return this.blockProcessor.processBlocksJob(blocks, payloadEnvelopes, opts);
  }

  async processExecutionPayload(payloadInput: PayloadEnvelopeInput, opts?: ImportPayloadOpts): Promise<void> {
    return this.payloadEnvelopeProcessor.processPayloadEnvelopeJob(payloadInput, opts);
  }

  processProposerEquivocation(slot: Slot, proposerIndex: ValidatorIndex): void {
    this.beaconEngine.processProposerEquivocation(slot, proposerIndex);
  }

  getStatus(): Status {
    // Read the cached head instead of the engine — its finalized* fields ARE the head state's
    // finalized checkpoint (exactly what Status wants), so no separate getFinalizedCheckpoint() call.
    const head = this.getHead();
    const boundary = this.config.getForkBoundaryAtEpoch(this.clock.currentEpoch);
    return {
      // fork_digest: The node's ForkDigest (compute_fork_digest(current_fork_version, genesis_validators_root)) where
      // - current_fork_version is the fork version at the node's current epoch defined by the wall-clock time (not necessarily the epoch to which the node is sync)
      // - genesis_validators_root is the static Root found in state.genesis_validators_root
      // - epoch of fork boundary is used to get blob parameters of current Blob Parameter Only (BPO) fork
      forkDigest: this.config.forkBoundary2ForkDigest(boundary),
      // finalized_root: state.finalized_checkpoint.root for the state corresponding to the head block (Note this defaults to Root(b'\x00' * 32) for the genesis finalized checkpoint).
      finalizedRoot: head.finalizedEpoch === GENESIS_EPOCH ? ZERO_HASH : fromHex(head.finalizedRoot),
      finalizedEpoch: head.finalizedEpoch,
      // TODO: PERFORMANCE: Memoize to prevent re-computing every time
      headRoot: fromHex(head.blockRoot),
      headSlot: head.slot,
      earliestAvailableSlot: this._earliestAvailableSlot,
    };
  }

  // Source: unstable@1bf214377e chain/blocks/importExecutionPayload.ts, post-import event emission.
  private onExecutionPayloadImported = (
    event: BeaconEngineEventData[BeaconEngineEvent.executionPayloadImported]
  ): void => {
    if (this.clock.currentSlot - event.slot < EVENTSTREAM_EMIT_RECENT_EXECUTION_PAYLOAD_SLOTS) {
      this.emitter.emit(routes.events.EventType.executionPayload, event);
    }
  };

  private onChainViewUpdated = (update: ChainViewUpdate): void => {
    const previousJustified = this.getJustifiedCheckpoint();
    const previousFinalized = this.getFinalizedCheckpoint();
    this.chainView.applyUpdate(update);
    this.emitter.emit(ChainEvent.chainViewUpdated, update);
    if (update.justified.epoch !== previousJustified.epoch || update.justified.rootHex !== previousJustified.rootHex) {
      this.emitter.emit(ChainEvent.forkChoiceJustified, this.getJustifiedCheckpoint());
    }
    if (update.finalized.epoch !== previousFinalized.epoch || update.finalized.rootHex !== previousFinalized.rootHex) {
      this.emitter.emit(ChainEvent.forkChoiceFinalized, this.getFinalizedCheckpoint());
    }
  };

  /**
   * Returns Promise that resolves either on block found or once 1 slot passes.
   * Used to handle unknown block root for both unaggregated and aggregated attestations.
   * @returns true if blockFound
   */
  waitForBlock(slot: Slot, root: RootHex): Promise<boolean> {
    return this.reprocessController.waitForBlockOfAttestation(slot, root);
  }

  persistBlock(data: BeaconBlock | BlindedBeaconBlock, suffix?: string): void {
    const slot = data.slot;
    if (isBlindedBeaconBlock(data)) {
      const sszType = this.config.getPostBellatrixForkTypes(slot).BlindedBeaconBlock;
      void this.persistSszObject(
        "BlindedBeaconBlock",
        sszType.serialize(data),
        toRootHex(sszType.hashTreeRoot(data)),
        suffix
      );
    } else {
      const sszType = this.config.getForkTypes(slot).BeaconBlock;
      void this.persistSszObject("BeaconBlock", sszType.serialize(data), toRootHex(sszType.hashTreeRoot(data)), suffix);
    }
  }

  persistExecutionPayloadEnvelope(envelope: gloas.ExecutionPayloadEnvelope): void {
    const blockRoot = toRootHex(envelope.beaconBlockRoot);
    void this.persistSszObject(
      "ExecutionPayloadEnvelope",
      ssz.gloas.ExecutionPayloadEnvelope.serialize(envelope),
      blockRoot,
      "produced_execution_payload_envelope"
    ).catch((e) => {
      this.logger.error(
        "Error persisting produced execution payload envelope",
        {slot: envelope.payload.slotNumber, blockRoot},
        e as Error
      );
    });
  }

  persistInvalidSszValue<T>(type: Type<T>, sszObject: T, suffix?: string, rootHex?: RootHex): void {
    if (this.opts.persistInvalidSszObjects) {
      void this.persistSszObject(
        type.typeName,
        type.serialize(sszObject),
        // in SignedBeaconBlock case, we want to use BeaconBlock root instead
        rootHex ?? toRootHex(type.hashTreeRoot(sszObject)),
        suffix
      );
    }
  }

  persistInvalidSszBytes(typeName: string, sszBytes: Uint8Array, rootHex: RootHex, suffix?: string): void {
    if (this.opts.persistInvalidSszObjects) {
      void this.persistSszObject(typeName, sszBytes, rootHex, suffix);
    }
  }

  private async persistSszObject(prefix: string, bytes: Uint8Array, root: RootHex, logStr?: string): Promise<void> {
    await persistInvalidSszObject(
      this.opts.persistInvalidSszObjectsDir ?? "invalid_ssz_objects",
      this.logger,
      prefix,
      bytes,
      fromHex(root),
      logStr
    );
  }

  private onScrapeMetrics(metrics: Metrics): void {
    // All op-pool sizes are reported by the engine (the pools are engine-internal).
    metrics.chain.blacklistedBlocks.set(this.blacklistedBlocks.size);
    metrics.bls.pubkeyCacheSize.set(this.pubkeyCache.size);
    metrics.bls.pubkeyCacheCapacity.set(this.pubkeyCache.capacity);

    // TODO - beacon engine: move metrics to BeaconEngine?
    const pendingCounts = this.beaconEngine.getHeadPendingCounts();
    if (pendingCounts) {
      metrics.pendingDeposits.set(pendingCounts.pendingDeposits);
      metrics.pendingPartialWithdrawals.set(pendingCounts.pendingPartialWithdrawals);
      metrics.pendingConsolidations.set(pendingCounts.pendingConsolidations);
    }
  }

  private onClockSlot(slot: Slot): void {
    this.logger.verbose("Clock slot", {slot});

    // CRITICAL UPDATE
    const irrecoverableError = this.beaconEngine.getIrrecoverableError();
    if (irrecoverableError) {
      this.processShutdownCallback(irrecoverableError);
    }

    this.beaconEngine.updateTime(slot);
    this.metrics?.clockSlot.set(slot);

    // Engine-owned pools + seen-caches are pruned by the engine's own clock listener.
    this.reprocessController.onSlot(slot);

    // Prune old cached block production artifacts, those are only useful on their slot
    pruneSetToMax(this.blockProductionCache, this.opts.maxCachedProducedRoots ?? DEFAULT_MAX_CACHED_PRODUCED_RESULTS);
    this.metrics?.blockProductionCacheSize.set(this.blockProductionCache.size);
  }

  private onClockEpoch(epoch: Epoch): void {
    this.metrics?.clockEpoch.set(epoch);
    // Engine-owned caches (seen-caches, seenBlockAttesters, beaconProposerCache) are pruned by the
    // engine's own clock listener; nothing epoch-scoped remains facade-side.
  }

  private onForkChoiceJustified(this: BeaconChain, cp: CheckpointWithHex): void {
    this.logger.verbose("Fork choice justified", {epoch: cp.epoch, root: cp.rootHex});
  }

  private async onForkChoiceFinalized(this: BeaconChain, cp: CheckpointWithHex): Promise<void> {
    this.logger.verbose("Fork choice finalized", {epoch: cp.epoch, root: cp.rootHex});
    this.metrics?.finalizedEpoch.set(cp.epoch);
    const finalizedBlock = this.getBlockHexDefaultStatus(cp.rootHex);
    if (finalizedBlock) {
      // The callback runs synchronously inside fork choice checkpoint updates, defer writing to subscribers
      callInNextEventLoop(() => {
        this.emitter.emit(routes.events.EventType.finalizedCheckpoint, {
          block: cp.rootHex,
          epoch: cp.epoch,
          state: finalizedBlock.stateRoot,
          executionOptimistic: isOptimisticBlock(finalizedBlock),
        });
      });
    } else {
      this.logger.debug("Finalized block not found in fork choice, skip finalized_checkpoint event", {
        epoch: cp.epoch,
        root: cp.rootHex,
      });
    }

    // Engine prunes proposer observations in pruneOnFinalized below.

    // Update validator custody to account for effective balance changes
    await this.updateValidatorsCustodyRequirement(cp);

    // Engine prunes its own op pool + seen-block-proposers on finalization.
    await this.beaconEngine.pruneOnFinalized();
  }

  async updateBeaconProposerData(epoch: Epoch, proposers: ProposerPreparationData[]): Promise<void> {
    // Engine owns the proposer cache; it returns whether new validators were discovered.
    const discoveredNewValidators = this.beaconEngine.updateProposerPreparation(epoch, proposers);

    // Only update validator custody if we discovered new validators
    if (discoveredNewValidators) {
      const finalizedCheckpoint = this.getFinalizedCheckpoint();
      await this.updateValidatorsCustodyRequirement(finalizedCheckpoint);
    }
  }

  private async updateValidatorsCustodyRequirement(finalizedCheckpoint: CheckpointWithHex): Promise<void> {
    if (this.custodyConfig.targetCustodyGroupCount === this.config.NUMBER_OF_CUSTODY_GROUPS) {
      // Custody requirements can only be increased, we can disable dynamic custody updates
      // if the node already maintains custody of all custody groups in case it is configured
      // as a supernode or has validators attached with a total effective balance of at least 4096 ETH.
      return;
    }

    // Validators attached to the node
    const validatorIndices = this.beaconEngine.getProposerCacheValidatorIndices();

    // Update custody requirement based on finalized state
    let effectiveBalances: number[];
    const effectiveBalanceIncrements = this.beaconEngine.getCheckpointEffectiveBalances(finalizedCheckpoint);
    if (effectiveBalanceIncrements) {
      effectiveBalances = validatorIndices.map(
        (index) => (effectiveBalanceIncrements[index] ?? 0) * EFFECTIVE_BALANCE_INCREMENT
      );
    } else {
      // If there's no cached effective balances, get the state from disk and parse them out
      this.logger.debug("No cached finalized effective balances to update target custody group count", {
        finalizedEpoch: finalizedCheckpoint.epoch,
        finalizedRoot: finalizedCheckpoint.rootHex,
      });

      const effectiveBalancesFromState = await this.beaconEngine.getFinalizedEffectiveBalances(
        finalizedCheckpoint,
        validatorIndices
      );
      if (!effectiveBalancesFromState) {
        // If even the state is not available, we cannot update the custody group count
        this.logger.debug("No finalized state or bytes available to update target custody group count", {
          finalizedEpoch: finalizedCheckpoint.epoch,
          finalizedRoot: finalizedCheckpoint.rootHex,
        });
        return;
      }

      effectiveBalances = effectiveBalancesFromState;
    }

    const targetCustodyGroupCount = getValidatorsCustodyRequirement(this.config, effectiveBalances);
    // Only update if target is increased
    if (targetCustodyGroupCount > this.custodyConfig.targetCustodyGroupCount) {
      this.custodyConfig.updateTargetCustodyGroupCount(targetCustodyGroupCount);
      this.metrics?.peerDas.custodyGroupCount.set(targetCustodyGroupCount);
      this.logger.verbose("Updated target custody group count", {
        finalizedEpoch: finalizedCheckpoint.epoch,
        validatorCount: validatorIndices.length,
        targetCustodyGroupCount,
      });
      this.emitter.emit(ChainEvent.updateTargetCustodyGroupCount, targetCustodyGroupCount);
    }
  }
}
