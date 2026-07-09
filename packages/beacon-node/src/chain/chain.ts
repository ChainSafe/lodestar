import path from "node:path";
import {PrivateKey} from "@libp2p/interface";
import {Type} from "@chainsafe/ssz";
import {BeaconConfig} from "@lodestar/config";
import {CheckpointWithHex, ProtoBlock} from "@lodestar/fork-choice";
import {LoggerNode} from "@lodestar/logger/node";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  type ForkPostFulu,
  type ForkPostGloas,
  GENESIS_SLOT,
  SLOTS_PER_EPOCH,
  isForkPostGloas,
} from "@lodestar/params";
import {
  IBeaconStateView,
  PubkeyCache,
  computeEndSlotAtEpoch,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getEffectiveBalancesFromStateBytes,
  isStatePostAltair,
  isStatePostElectra,
  isStatePostGloas,
} from "@lodestar/state-transition";
import {
  BeaconBlock,
  BlindedBeaconBlock,
  BlindedBeaconBlockBody,
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
  deneb,
  gloas,
  isBlindedBeaconBlock,
  phase0,
  rewards,
  ssz,
  sszTypesFor,
} from "@lodestar/types";
import {Logger, fromHex, gweiToWei, isErrorAborted, pruneSetToMax, sleep, toRootHex} from "@lodestar/utils";
import {ProcessShutdownCallback} from "@lodestar/validator";
import {GENESIS_EPOCH, ZERO_HASH} from "../constants/index.js";
import {IBeaconChainDb, IBeaconDb} from "../db/index.js";
import {BLOB_SIDECARS_IN_WRAPPER_INDEX} from "../db/repositories/blobSidecars.js";
import {BuilderStatus} from "../execution/builder/http.js";
import {IExecutionBuilder, IExecutionEngine} from "../execution/index.js";
import {Metrics} from "../metrics/index.js";
import {computeNodeIdFromPrivateKey} from "../network/subnets/interface.js";
import {Clock, ClockEvent, IClock} from "../util/clock.js";
import {CustodyConfig, getValidatorsCustodyRequirement} from "../util/dataColumns.js";
import {callInNextEventLoop} from "../util/eventLoop.js";
import {ensureDir, writeIfNotExist} from "../util/file.js";
import {isOptimisticBlock} from "../util/forkChoice.js";
import {JobItemQueue} from "../util/queue/itemQueue.js";
import {SerializedCache} from "../util/serializedCache.js";
import {BlockRootSlot} from "../util/sszBytes.js";
import {ArchiveStore} from "./archiveStore/archiveStore.js";
import {BeaconEngine} from "./beaconEngine/index.js";
import {IBlockInput, isBlockInputBlobs, isBlockInputColumns} from "./blocks/blockInput/index.js";
import {BlockProcessor, ImportBlockOpts} from "./blocks/index.js";
import {PayloadEnvelopeProcessor} from "./blocks/payloadEnvelopeProcessor.js";
import {ImportPayloadOpts} from "./blocks/types.js";
import {persistBlockInput} from "./blocks/writeBlockInputToDb.js";
import {persistPayloadEnvelopeInput} from "./blocks/writePayloadEnvelopeInputToDb.js";
import {IBlsVerifier} from "./bls/index.js";
import {ColumnReconstructionTracker} from "./ColumnReconstructionTracker.js";
import {ChainEvent, ChainEventEmitter} from "./emitter.js";
import {GetBlobsTracker} from "./GetBlobsTracker.js";
import {CommonBlockBody, IBeaconChain, ProposerPreparationData, StateGetOpts} from "./interface.js";
import {LightClientServer} from "./lightClient/index.js";
import {IChainOptions} from "./options.js";
import {PrepareNextSlotScheduler} from "./prepareNextSlot.js";
import {AssembledBlockType, BlockType, ProduceResult} from "./produceBlock/index.js";
import {BlockAttributes, PreparedBlockScalars, produceBlockBody} from "./produceBlock/produceBlockBody.js";
import {QueuedStateRegenerator, RegenCaller} from "./regen/index.js";
import {ReprocessController} from "./reprocess.js";
import {PayloadEnvelopeInput, SeenPayloadEnvelopeInput} from "./seenCache/index.js";
import {SeenBlockInput} from "./seenCache/seenGossipBlockInput.js";
import {DbCPStateDatastore, checkpointToDatastoreKey} from "./stateCache/datastore/db.js";
import {FileCPStateDatastore} from "./stateCache/datastore/file.js";
import {CPStateDatastore} from "./stateCache/datastore/types.js";
import {ValidatorMonitor} from "./validatorMonitor.js";

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

export class BeaconChain implements IBeaconChain {
  readonly genesisTime: UintNum64;
  readonly genesisValidatorsRoot: Root;
  // TODO - beacon engine: narrow this to `IBeaconEngine` so the facade can't reach engine-owned
  // consensus state. Blocked on the facade's remaining concrete-only reads — `bls` (kept shared; add to
  // IBeaconEngine as a carve-out), `regen` and `lightClientServer` — which must route through engine
  // methods first (Part B / BLK-1 + BLK-3). Narrowing now would force `as BeaconEngine` casts here + in
  // ~46 validation unit-test call sites.
  readonly beaconEngine: BeaconEngine;
  readonly executionEngine: IExecutionEngine;
  readonly executionBuilder?: IExecutionBuilder;
  // Expose config for convenience in modularized functions
  readonly config: BeaconConfig;
  readonly custodyConfig: CustodyConfig;
  readonly logger: Logger;
  readonly metrics: Metrics | null;
  readonly validatorMonitor: ValidatorMonitor | null;

  readonly anchorStateLatestBlockSlot: Slot;

  // TODO - beacon engine: remove this?
  get bls(): IBlsVerifier {
    return this.beaconEngine.bls;
  }
  // Cached head ProtoBlock, updated from importBlock's result. Lets the facade serve getStatus and
  // detect finalized/justified transitions (it carries finalized*/justified* checkpoints) without the
  // engine emitting into the JS emitter (FFI-honest). Not the source of truth for all head reads yet.
  // TODO - beacon engine: last fork-choice-derived field on the facade — move into the engine (the head
  // cache belongs in NativeBeaconEngine); the checkpoint-event emission that reads it moves too.
  private headProtoBlock: ProtoBlock;
  readonly clock: IClock;
  readonly emitter: ChainEventEmitter;
  // TODO - beacon engine: remove this
  get regen(): QueuedStateRegenerator {
    return this.beaconEngine.regen;
  }
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
  // Facade owns DA + light-client + backfill stores only; block/state/envelope/op-pool repos are
  // engine-owned (reached via `beaconEngine`). Bootstrap passes the full `IBeaconDb`, narrowed here.
  protected readonly db: IBeaconChainDb;
  // this is only available if nHistoricalStates is enabled
  private readonly cpStateDatastore?: CPStateDatastore;
  private abortController = new AbortController();
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

  constructor(
    opts: IChainOptions,
    {
      privateKey,
      config,
      pubkeyCache,
      db,
      dbName,
      dataDir,
      logger,
      processShutdownCallback,
      clock,
      metrics,
      validatorMonitor,
      anchorState,
      isAnchorStateFinalized,
      executionEngine,
      executionBuilder,
    }: {
      privateKey: PrivateKey;
      config: BeaconConfig;
      pubkeyCache: PubkeyCache;
      db: IBeaconDb;
      dbName: string;
      dataDir: string;
      logger: Logger;
      processShutdownCallback: ProcessShutdownCallback;
      /** Used for testing to supply fake clock */
      clock?: IClock;
      metrics: Metrics | null;
      validatorMonitor: ValidatorMonitor | null;
      anchorState: IBeaconStateView;
      isAnchorStateFinalized: boolean;
      executionEngine: IExecutionEngine;
      executionBuilder?: IExecutionBuilder;
    }
  ) {
    this.opts = opts;
    this.config = config;
    this.db = db;
    this.logger = logger;
    this.processShutdownCallback = processShutdownCallback;
    this.metrics = metrics;
    this.validatorMonitor = validatorMonitor;
    this.genesisTime = anchorState.genesisTime;
    this.anchorStateLatestBlockSlot = anchorState.latestBlockHeader.slot;
    this.genesisValidatorsRoot = anchorState.genesisValidatorsRoot;
    this.executionEngine = executionEngine;
    this.executionBuilder = executionBuilder;
    const signal = this.abortController.signal;
    const emitter = new ChainEventEmitter();

    if (!clock) clock = new Clock({config, genesisTime: this.genesisTime, signal});

    const fileDataStore = opts.nHistoricalStatesFileDataStore ?? true;
    // checkpointState is an engine repo; build the datastore from the bootstrap `db` (union) param.
    this.cpStateDatastore = fileDataStore ? new FileCPStateDatastore(dataDir) : new DbCPStateDatastore(db);

    const nodeId = computeNodeIdFromPrivateKey(privateKey);
    const initialCustodyGroupCount = opts.initialCustodyGroupCount ?? config.CUSTODY_REQUIREMENT;
    this.metrics?.peerDas.custodyGroupCount.set(initialCustodyGroupCount);
    // TODO: backfill not implemented yet
    this.metrics?.peerDas.custodyGroupsBackfilled.set(0);
    this.custodyConfig = new CustodyConfig({
      nodeId,
      config,
      initialCustodyGroupCount,
    });

    this.serializedCache = new SerializedCache();
    // seenBlockInputCache stays facade-owned but is built before the engine so it can be injected into regen.
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

    this.beaconEngine = new BeaconEngine(
      {
        opts,
        config,
        logger,
        metrics,
        clock,
        pubkeyCache,
        cpStateDatastore: this.cpStateDatastore,
        emitter,
        signal,
        db,
        validatorMonitor,
        seenBlockInputCache: this.seenBlockInputCache,
        isAnchorStateFinalized,
      },
      anchorState
    );
    // Seed the facade head cache from the engine's initial head (one-time read); refreshed on each import.
    this.headProtoBlock = this.beaconEngine.getHead();

    this.blacklistedBlocks = new Map((opts.blacklistedBlocks ?? []).map((hex) => [hex, null]));

    this._earliestAvailableSlot = anchorState.slot;

    // Global cache of validators pubkey/index mapping
    this.pubkeyCache = pubkeyCache;

    const {checkpoint} = anchorState.computeAnchorCheckpoint();

    if (!opts.disableLightClientServer) {
      this.lightClientServer = new LightClientServer(opts, {config, clock, db, metrics, emitter, logger, signal});
    }

    this.reprocessController = new ReprocessController(this.metrics);

    this.blockProcessor = new BlockProcessor(this, metrics, opts, signal);
    this.payloadEnvelopeProcessor = new PayloadEnvelopeProcessor(this, metrics, signal);

    this.seenPayloadEnvelopeInputCache = new SeenPayloadEnvelopeInput({
      config,
      clock,
      beaconEngine: this.beaconEngine,
      chainEvents: emitter,
      signal,
      serializedCache: this.serializedCache,
      metrics,
      logger,
    });
    // Inject lightClientServer post-construction (created after engine, depends on nothing from engine)
    // TODO - beacon engine
    this.beaconEngine.lightClientServer = this.lightClientServer;

    const anchorBlockSlot = anchorState.latestBlockHeader.slot;
    if (isStatePostGloas(anchorState) && anchorBlockSlot > 0) {
      const anchorBid = anchorState.latestExecutionPayloadBid;
      this.seenPayloadEnvelopeInputCache.addFromBid({
        blockRootHex: toRootHex(checkpoint.root),
        slot: anchorBlockSlot,
        forkName: anchorState.forkName,
        proposerIndex: anchorState.latestBlockHeader.proposerIndex,
        bid: anchorBid,
        sampledColumns: this.custodyConfig.sampledColumns,
        custodyColumns: this.custodyConfig.custodyColumns,
        timeCreatedSec: Math.floor(Date.now() / 1000),
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
      {...opts, dbName, anchorState: {finalizedCheckpoint: anchorState.finalizedCheckpoint}},
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
    emitter.addListener(ChainEvent.checkpoint, this.onCheckpoint.bind(this));
  }

  async init(): Promise<void> {
    await this.archiveStore.init();
    await this.loadFromDisk();
  }

  async close(): Promise<void> {
    await this.archiveStore.close();
    await this.bls.close();

    // Since we don't persist unfinalized fork-choice,
    // we can abort any ongoing unfinalized block writes.
    // TODO: persist fork choice to disk and allow unfinalized block writes to complete.
    this.unfinalizedBlockWrites.dropAllJobs();
    this.unfinalizedPayloadEnvelopeWrites.dropAllJobs();

    this.abortController.abort();
  }

  seenBlock(blockRoot: RootHex): boolean {
    return this.seenBlockInputCache.hasBlock(blockRoot) || this.beaconEngine.hasBlockHexUnsafe(blockRoot);
  }

  seenPayloadEnvelope(blockRoot: RootHex): boolean {
    return this.seenPayloadEnvelopeInputCache.hasPayload(blockRoot) || this.beaconEngine.hasPayloadHexUnsafe(blockRoot);
  }

  regenCanAcceptWork(): boolean {
    return this.regen.canAcceptWork();
  }

  blsThreadPoolCanAcceptWork(): boolean {
    return this.bls.canAcceptWork();
  }

  validatorSeenAtEpoch(index: ValidatorIndex, epoch: Epoch): boolean {
    // Caller must check that epoch is not older that current epoch - 1
    // else the caches for that epoch may already be pruned.
    // All liveness caches (seenBlockAttesters + gossip caches) are engine-internal.
    return this.beaconEngine.validatorSeenAtEpoch(index, epoch);
  }

  /** Populate in-memory caches with persisted data. Call at least once on startup */
  async loadFromDisk(): Promise<void> {
    await this.regen.init();
    await this.beaconEngine.loadOpPoolFromDisk();
  }

  /** Persist in-memory data to the DB. Call at least once before stopping the process */
  async persistToDisk(): Promise<void> {
    await this.archiveStore.persistToDisk();
    await this.beaconEngine.persistOpPoolToDisk();
  }

  // TODO - beacon engine: remove this
  getHeadState(): IBeaconStateView {
    // head state should always exist
    const head = this.beaconEngine.getHead();
    const headState = this.regen.getClosestHeadState(head);
    if (!headState) {
      throw Error(`headState does not exist for head root=${head.blockRoot} slot=${head.slot}`);
    }
    return headState;
  }

  async getHeadStateAtCurrentEpoch(regenCaller: RegenCaller): Promise<IBeaconStateView> {
    return this.getHeadStateAtEpoch(this.clock.currentEpoch, regenCaller);
  }

  async getHeadStateAtEpoch(epoch: Epoch, regenCaller: RegenCaller): Promise<IBeaconStateView> {
    // using getHeadState() means we'll use checkpointStateCache if it's available
    const headState = this.getHeadState();
    // head state is in the same epoch, or we pulled up head state already from past epoch
    if (epoch <= computeEpochAtSlot(headState.slot)) {
      // should go to this most of the time
      return headState;
    }
    // only use regen queue if necessary, it'll cache in checkpointStateCache if regen gets through epoch transition
    const head = this.beaconEngine.getHead();
    const startSlot = computeStartSlotAtEpoch(epoch);
    return this.regen.getBlockSlotState(head, startSlot, {dontTransferCache: true}, regenCaller);
  }

  async getStateBySlot(
    slot: Slot,
    opts?: StateGetOpts
  ): Promise<{state: IBeaconStateView; executionOptimistic: boolean; finalized: boolean} | null> {
    const finalizedBlock = this.beaconEngine.getFinalizedBlock();

    if (slot < finalizedBlock.slot) {
      // request for finalized state not supported in this API
      // fall back to caller to look in db or getHistoricalStateBySlot
      return null;
    }

    if (opts?.allowRegen) {
      // Find closest canonical block to slot, then trigger regen
      const block = this.beaconEngine.getCanonicalBlockClosestLteSlot(slot) ?? finalizedBlock;
      const state = await this.regen.getBlockSlotState(block, slot, {dontTransferCache: true}, RegenCaller.restApi);
      return {
        state,
        executionOptimistic: isOptimisticBlock(block),
        finalized: slot === finalizedBlock.slot && finalizedBlock.slot !== GENESIS_SLOT,
      };
    }

    // Just check if state is already in the cache. If it's not dialed to the correct slot,
    // do not bother in advancing the state. restApiCanTriggerRegen == false means do no work
    const block = this.beaconEngine.getCanonicalProtoBlockAtSlot(slot);
    if (!block) {
      return null;
    }

    const state = this.regen.getStateSync(block.stateRoot);
    return (
      state && {
        state,
        executionOptimistic: isOptimisticBlock(block),
        finalized: slot === finalizedBlock.slot && finalizedBlock.slot !== GENESIS_SLOT,
      }
    );
  }

  async getHistoricalStateBySlot(
    slot: number
  ): Promise<{state: Uint8Array; executionOptimistic: boolean; finalized: boolean} | null> {
    if (!this.opts.serveHistoricalState) {
      throw Error("Historical state regen is not enabled, set --serveHistoricalState to fetch this data");
    }

    return this.archiveStore.getHistoricalStateBySlot(slot);
  }

  async getStateByStateRoot(
    stateRoot: RootHex,
    opts?: StateGetOpts
  ): Promise<{state: IBeaconStateView | Uint8Array; executionOptimistic: boolean; finalized: boolean} | null> {
    if (opts?.allowRegen) {
      const state = await this.regen.getState(stateRoot, RegenCaller.restApi);
      const block = this.beaconEngine.getBlockDefaultStatus(
        ssz.phase0.BeaconBlockHeader.hashTreeRoot(state.latestBlockHeader)
      );
      const finalizedEpoch = this.beaconEngine.getFinalizedCheckpoint().epoch;
      return {
        state,
        executionOptimistic: block != null && isOptimisticBlock(block),
        finalized: state.epoch <= finalizedEpoch && finalizedEpoch !== GENESIS_EPOCH,
      };
    }

    // TODO: This can only fulfill requests for a very narrow set of roots.
    // - very recent states that happen to be in the cache
    // - 1 every 100s of states that are persisted in the archive state

    // TODO: This is very inneficient for debug requests of serialized content, since it deserializes to serialize again
    const cachedStateCtx = this.regen.getStateSync(stateRoot);
    if (cachedStateCtx) {
      const block = this.beaconEngine.getBlockDefaultStatus(
        ssz.phase0.BeaconBlockHeader.hashTreeRoot(cachedStateCtx.latestBlockHeader)
      );
      const finalizedEpoch = this.beaconEngine.getFinalizedCheckpoint().epoch;
      return {
        state: cachedStateCtx,
        executionOptimistic: block != null && isOptimisticBlock(block),
        finalized: cachedStateCtx.epoch <= finalizedEpoch && finalizedEpoch !== GENESIS_EPOCH,
      };
    }

    // this is mostly useful for a node with `--chain.archiveStateEpochFrequency 1`
    const data = await this.beaconEngine.getSerializedStateByRoot(fromHex(stateRoot));
    return data && {state: data, executionOptimistic: false, finalized: true};
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

  getStateByCheckpoint(
    checkpoint: CheckpointWithHex
  ): {state: IBeaconStateView; executionOptimistic: boolean; finalized: boolean} | null {
    // finalized or justified checkpoint states maynot be available with PersistentCheckpointStateCache, use getCheckpointStateOrBytes() api to get Uint8Array
    const checkpointHex = {epoch: checkpoint.epoch, rootHex: checkpoint.rootHex};
    const cachedStateCtx = this.regen.getCheckpointStateSync(checkpointHex);
    if (cachedStateCtx) {
      const block = this.beaconEngine.getBlockDefaultStatus(
        ssz.phase0.BeaconBlockHeader.hashTreeRoot(cachedStateCtx.latestBlockHeader)
      );
      const finalizedEpoch = this.beaconEngine.getFinalizedCheckpoint().epoch;
      return {
        state: cachedStateCtx,
        executionOptimistic: block != null && isOptimisticBlock(block),
        finalized: cachedStateCtx.epoch <= finalizedEpoch && finalizedEpoch !== GENESIS_EPOCH,
      };
    }

    return null;
  }

  async getStateOrBytesByCheckpoint(
    checkpoint: CheckpointWithHex
  ): Promise<{state: IBeaconStateView | Uint8Array; executionOptimistic: boolean; finalized: boolean} | null> {
    const checkpointHex = {epoch: checkpoint.epoch, rootHex: checkpoint.rootHex};
    const cachedStateCtx = await this.regen.getCheckpointStateOrBytes(checkpointHex);
    if (cachedStateCtx) {
      const block = this.beaconEngine.getBlockDefaultStatus(checkpoint.root);
      const finalizedEpoch = this.beaconEngine.getFinalizedCheckpoint().epoch;
      return {
        state: cachedStateCtx,
        executionOptimistic: block != null && isOptimisticBlock(block),
        finalized: checkpoint.epoch <= finalizedEpoch && finalizedEpoch !== GENESIS_EPOCH,
      };
    }

    return null;
  }

  async getCanonicalBlockAtSlot(
    slot: Slot
  ): Promise<{block: SignedBeaconBlock; executionOptimistic: boolean; finalized: boolean} | null> {
    const finalizedBlock = this.beaconEngine.getFinalizedBlock();
    if (slot > finalizedBlock.slot) {
      // Unfinalized slot, attempt to find in fork-choice
      const block = this.beaconEngine.getCanonicalProtoBlockAtSlot(slot);
      if (block) {
        // Block found in fork-choice.
        // It may be in the block input cache, awaiting full DA reconstruction, check there first
        // Otherwise (most likely), the engine reads the hot db (falling back to cold on an archive race)
        const blockInput = this.seenBlockInputCache.get(block.blockRoot);
        if (blockInput?.hasBlock()) {
          return {block: blockInput.getBlock(), executionOptimistic: isOptimisticBlock(block), finalized: false};
        }
        const res = await this.beaconEngine.getSerializedBlockByRoot(fromHex(block.blockRoot));
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

    const bytes = await this.beaconEngine.getSerializedFinalizedBlockBySlot(slot);
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
    const protoBlock = this.beaconEngine.getBlockHexDefaultStatus(root);
    if (protoBlock) {
      // Block found in fork-choice.
      // It may be in the block input cache, awaiting full DA reconstruction, check there first
      // Otherwise (most likely), the engine reads the hot db (falling back to cold on an archive race)
      const blockInput = this.seenBlockInputCache.get(protoBlock.blockRoot);
      if (blockInput?.hasBlock()) {
        return {block: blockInput.getBlock(), executionOptimistic: isOptimisticBlock(protoBlock), finalized: false};
      }
    }

    // Engine reads hot→cold and reports which; deserialize facade-side (no object crosses the seam)
    const res = await this.beaconEngine.getSerializedBlockByRoot(fromHex(root));
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
    const protoBlock = this.beaconEngine.getBlockHexDefaultStatus(toRootHex(root));
    if (protoBlock) {
      // Block found in fork-choice.
      // It may be in the block input cache, awaiting full DA reconstruction, check there first
      // Otherwise (most likely), the engine reads the hot db (falling back to cold on an archive race)
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

    const res = await this.beaconEngine.getSerializedBlockByRoot(root);
    return (
      res && {
        block: res.bytes,
        executionOptimistic: protoBlock != null && isOptimisticBlock(protoBlock),
        finalized: res.finalized,
        slot: res.slot,
      }
    );
  }

  /** Engine passthrough: serialized finalized block by slot (cold archive). */
  getSerializedFinalizedBlockBySlot(slot: Slot): Promise<Uint8Array | null> {
    return this.beaconEngine.getSerializedFinalizedBlockBySlot(slot);
  }

  /** Engine passthrough: thin BeaconBlocksByRange serving refs (fork choice read engine-side). */
  getCanonicalBlockRootSlotsByRange(
    startSlot: Slot,
    endSlot: Slot
  ): {finalizedSlot: Slot; nonFinalized: BlockRootSlot[]} {
    return this.beaconEngine.getCanonicalBlockRootSlotsByRange(startSlot, endSlot);
  }

  /** Engine passthrough: finalized block slot by root (cold archive index). */
  getFinalizedBlockSlotByRoot(root: Uint8Array): Promise<Slot | null> {
    return this.beaconEngine.getFinalizedBlockSlotByRoot(root);
  }

  /** Engine passthrough: serialized finalized block by parent root (cold archive index). */
  getSerializedFinalizedBlockByParentRoot(parentRoot: Uint8Array): Promise<Uint8Array | null> {
    return this.beaconEngine.getSerializedFinalizedBlockByParentRoot(parentRoot);
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

  async getSerializedExecutionPayloadEnvelope(blockSlot: Slot, blockRoot: Uint8Array): Promise<Uint8Array | null> {
    // Facade owns the DA cache (keyed by hex); check it before the engine's DB read.
    const payloadInput = this.seenPayloadEnvelopeInputCache.get(toRootHex(blockRoot));
    if (payloadInput?.hasPayloadEnvelope()) {
      const envelope = payloadInput.getPayloadEnvelope();
      return this.serializedCache.get(envelope) ?? ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope);
    }
    return this.beaconEngine.getSerializedExecutionPayloadEnvelope(blockSlot, blockRoot);
  }

  /** Engine passthrough: serialized finalized (cold-archive) envelope by slot. */
  getSerializedFinalizedExecutionPayloadEnvelope(slot: Slot): Promise<Uint8Array | null> {
    return this.beaconEngine.getSerializedFinalizedExecutionPayloadEnvelope(slot);
  }

  /** Engine passthrough: thin ByRange serving refs (fork choice read engine-side). */
  getFullBlockRootSlotsByRange(startSlot: Slot, endSlot: Slot): {finalizedSlot: Slot; nonFinalized: BlockRootSlot[]} {
    return this.beaconEngine.getFullBlockRootSlotsByRange(startSlot, endSlot);
  }

  async getExecutionPayloadEnvelope(
    blockSlot: Slot,
    blockRootHex: string
  ): Promise<gloas.SignedExecutionPayloadEnvelope | null> {
    // Facade owns the DA cache; check it before the engine's DB read.
    const payloadInput = this.seenPayloadEnvelopeInputCache.get(blockRootHex);
    if (payloadInput?.hasPayloadEnvelope()) {
      return payloadInput.getPayloadEnvelope();
    }
    return this.beaconEngine.getExecutionPayloadEnvelope(blockSlot, fromHex(blockRootHex));
  }

  async getParentExecutionRequests(
    parentBlockSlot: Slot,
    parentBlockRootHex: RootHex
  ): Promise<gloas.ExecutionRequests> {
    // at the fork boundary, parent is pre-gloas
    if (!isForkPostGloas(this.config.getForkName(parentBlockSlot))) {
      return ssz.gloas.ExecutionRequests.defaultValue();
    }
    const envelope = await this.getExecutionPayloadEnvelope(parentBlockSlot, parentBlockRootHex);
    if (envelope === null) {
      throw Error(`Parent execution payload envelope not found slot=${parentBlockSlot}, root=${parentBlockRootHex}`);
    }
    return envelope.message.executionRequests;
  }

  async getDataColumnSidecars(blockSlot: Slot, blockRootHex: string): Promise<DataColumnSidecar[]> {
    const fork = this.config.getForkName(blockSlot);

    if (isForkPostGloas(fork)) {
      // After gloas, columns are tracked in PayloadEnvelopeInput
      const payloadInput = this.seenPayloadEnvelopeInputCache.get(blockRootHex);
      if (payloadInput) {
        return payloadInput.getAllColumns();
      }
    } else {
      // Before gloas, columns are tracked in BlockInput
      const blockInput = this.seenBlockInputCache.get(blockRootHex);
      if (blockInput) {
        if (!isBlockInputColumns(blockInput)) {
          throw new Error(`Expected block input to have columns: slot=${blockSlot} root=${blockRootHex}`);
        }
        return blockInput.getAllColumns();
      }
    }

    const sidecarsUnfinalized = await this.db.dataColumnSidecar.values(fromHex(blockRootHex));
    if (sidecarsUnfinalized.length > 0) {
      return sidecarsUnfinalized;
    }
    const sidecarsFinalized = await this.db.dataColumnSidecarArchive.values(blockSlot);
    return sidecarsFinalized;
  }

  async getSerializedDataColumnSidecars(
    blockSlot: Slot,
    blockRootHex: string,
    indices: number[]
  ): Promise<(Uint8Array | undefined)[]> {
    const fork = this.config.getForkName(blockSlot);

    if (isForkPostGloas(fork)) {
      // After gloas, columns are tracked in PayloadEnvelopeInput
      const payloadInput = this.seenPayloadEnvelopeInputCache.get(blockRootHex);
      if (payloadInput) {
        return indices.map((index) => {
          const sidecar = payloadInput.getColumn(index);
          if (!sidecar) {
            return undefined;
          }
          const serialized = this.serializedCache.get(sidecar);
          if (serialized) {
            return serialized;
          }
          return sszTypesFor(fork as ForkPostGloas).DataColumnSidecar.serialize(sidecar);
        });
      }
    } else {
      // Before gloas, columns are tracked in BlockInput
      const blockInput = this.seenBlockInputCache.get(blockRootHex);
      if (blockInput) {
        if (!isBlockInputColumns(blockInput)) {
          throw new Error(`Expected block input to have columns: slot=${blockSlot} root=${blockRootHex}`);
        }
        return indices.map((index) => {
          const sidecar = blockInput.getColumn(index);
          if (!sidecar) {
            return undefined;
          }
          const serialized = this.serializedCache.get(sidecar);
          if (serialized) {
            return serialized;
          }
          return sszTypesFor(blockInput.forkName as ForkPostFulu).DataColumnSidecar.serialize(sidecar);
        });
      }
    }

    const sidecarsUnfinalized = await this.db.dataColumnSidecar.getManyBinary(fromHex(blockRootHex), indices);
    if (sidecarsUnfinalized.some((sidecar) => sidecar != null)) {
      return sidecarsUnfinalized;
    }
    const sidecarsFinalized = await this.db.dataColumnSidecarArchive.getManyBinary(blockSlot, indices);
    return sidecarsFinalized;
  }

  produceBlock(
    blockAttributes: BlockAttributes & {
      commonBlockBodyPromise: Promise<CommonBlockBody>;
    } & PreparedBlockScalars
  ): Promise<{
    block: BeaconBlock;
    executionPayloadValue: Wei;
    consensusBlockValue: Wei;
    shouldOverrideBuilder?: boolean;
  }> {
    return this.produceBlockWrapper<BlockType.Full>(BlockType.Full, blockAttributes);
  }

  produceBlindedBlock(
    blockAttributes: BlockAttributes & {
      commonBlockBodyPromise: Promise<CommonBlockBody>;
    } & PreparedBlockScalars
  ): Promise<{
    block: BlindedBeaconBlock;
    executionPayloadValue: Wei;
    consensusBlockValue: Wei;
  }> {
    return this.produceBlockWrapper<BlockType.Blinded>(BlockType.Blinded, blockAttributes);
  }

  async produceBlockWrapper<T extends BlockType>(
    blockType: T,
    {
      randaoReveal,
      graffiti,
      slot,
      feeRecipient,
      commonBlockBodyPromise,
      parentBlock,
      builderBid,
      // All scalars are precomputed once by produceBlockBase (both V3 and V4) and threaded through, so
      // produceBlockBody no longer needs a BeaconState here.
      proposerIndex,
      proposerPubKey,
      defaultFeeRecipient,
      feeRecipientCached,
      safeBlockHash,
      finalizedBlockHash,
      timestamp,
      prevRandao,
      parentBlockHash,
      parentGasLimit,
      isBuildingOnFull,
      parentExecutionRequests,
      payloadAttestations,
      withdrawals,
    }: BlockAttributes & {commonBlockBodyPromise: Promise<CommonBlockBody>} & PreparedBlockScalars
  ): Promise<{
    block: AssembledBlockType<T>;
    executionPayloadValue: Wei;
    consensusBlockValue: Wei;
    shouldOverrideBuilder?: boolean;
  }> {
    const {body, produceResult, executionPayloadValue, shouldOverrideBuilder} = await produceBlockBody.call(
      this,
      blockType,
      {
        randaoReveal,
        graffiti,
        slot,
        feeRecipient,
        parentBlock,
        proposerIndex,
        safeBlockHash,
        finalizedBlockHash,
        timestamp,
        prevRandao,
        parentBlockHash,
        parentGasLimit,
        isBuildingOnFull,
        parentExecutionRequests,
        payloadAttestations,
        withdrawals,
        proposerPubKey,
        defaultFeeRecipient,
        feeRecipientCached,
        commonBlockBodyPromise,
        builderBid,
      }
    );

    // The hashtree root computed here for debug log will get cached and hence won't introduce additional delays
    const bodyRoot =
      produceResult.type === BlockType.Full
        ? this.config.getForkTypes(slot).BeaconBlockBody.hashTreeRoot(body)
        : this.config
            .getPostBellatrixForkTypes(slot)
            .BlindedBeaconBlockBody.hashTreeRoot(body as BlindedBeaconBlockBody);
    this.logger.debug("Computing block post state from the produced body", {
      slot,
      bodyRoot: toRootHex(bodyRoot),
      blockType,
    });

    const block = {
      slot,
      proposerIndex,
      parentRoot: fromHex(parentBlock.blockRoot),
      stateRoot: ZERO_HASH,
      body,
    } as AssembledBlockType<T>;

    // Serialize the (zero-stateRoot) block for the bytes-first seam. The JS engine uses the POJO; the
    // serialized bytes + `blinded` flag are for the future native engine.
    const blinded = produceResult.type === BlockType.Blinded;
    const blockBytes = blinded
      ? this.config.getPostBellatrixForkTypes(slot).BlindedBeaconBlock.serialize(block as BlindedBeaconBlock)
      : this.config.getForkTypes(slot).BeaconBlock.serialize(block as BeaconBlock);
    const {newStateRoot, proposerReward} = await this.beaconEngine.computeNewStateRoot(block, blockBytes, blinded);
    block.stateRoot = newStateRoot;
    const blockRoot =
      produceResult.type === BlockType.Full
        ? this.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block)
        : this.config.getPostBellatrixForkTypes(slot).BlindedBeaconBlock.hashTreeRoot(block as BlindedBeaconBlock);
    const blockRootHex = toRootHex(blockRoot);

    const fork = this.config.getForkName(slot);
    // TODO GLOAS: we should retire BlockType post-gloas, may need a new enum for self vs non-self built
    if (isForkPostGloas(fork) && produceResult.type !== BlockType.Full) {
      throw Error(`Unexpected block type=${produceResult.type} for post-gloas fork=${fork}`);
    }

    // Track the produced block for consensus broadcast validations, later validation, etc.
    this.blockProductionCache.set(blockRootHex, produceResult);
    this.metrics?.blockProductionCacheSize.set(this.blockProductionCache.size);

    return {block, executionPayloadValue, consensusBlockValue: gweiToWei(proposerReward), shouldOverrideBuilder};
  }

  async processBlock(block: IBlockInput, opts?: ImportBlockOpts): Promise<void> {
    return this.blockProcessor.processBlocksJob([block], null, opts);
  }

  async processChainSegment(
    blocks: IBlockInput[],
    payloadEnvelopes: Map<Slot, PayloadEnvelopeInput> | null,
    opts?: ImportBlockOpts
  ): Promise<void> {
    await this.blockProcessor.processBlocksJob(blocks, payloadEnvelopes, opts);
  }

  async processExecutionPayload(payloadInput: PayloadEnvelopeInput, opts?: ImportPayloadOpts): Promise<void> {
    return this.payloadEnvelopeProcessor.processPayloadEnvelopeJob(payloadInput, opts);
  }

  getStatus(): Status {
    // Read the cached head instead of the engine — its finalized* fields ARE the head state's
    // finalized checkpoint (exactly what Status wants), so no separate getFinalizedCheckpoint() call.
    const head = this.headProtoBlock;
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

  /**
   * Single choke point for refreshing the cached head: pass the new canonical head here from ANY flow
   * that updates it (currently importBlock; head recompute / proposer-head selection are engine-internal).
   * It emits fork-choice justified/finalized transitions facade-side — the engine no longer emits these
   * (a native engine can't emit into the JS emitter); they are derived from the head ProtoBlock's
   * justified and finalized checkpoints. Head-derived: a checkpoint that advances only via an
   * epoch-boundary tick is emitted on the next head update.
   */
  updateHeadAndEmitCheckpointEvents(newHead: ProtoBlock): void {
    const prevHead = this.headProtoBlock;
    this.headProtoBlock = newHead;

    if (newHead.justifiedEpoch !== prevHead.justifiedEpoch || newHead.justifiedRoot !== prevHead.justifiedRoot) {
      this.emitter.emit(
        ChainEvent.forkChoiceJustified,
        protoCheckpointToWithHex(newHead.justifiedEpoch, newHead.justifiedRoot)
      );
    }
    if (newHead.finalizedEpoch !== prevHead.finalizedEpoch || newHead.finalizedRoot !== prevHead.finalizedRoot) {
      this.emitter.emit(
        ChainEvent.forkChoiceFinalized,
        protoCheckpointToWithHex(newHead.finalizedEpoch, newHead.finalizedRoot)
      );
    }
  }

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
      void this.persistSszObject("BlindedBeaconBlock", sszType.serialize(data), sszType.hashTreeRoot(data), suffix);
    } else {
      const sszType = this.config.getForkTypes(slot).BeaconBlock;
      void this.persistSszObject("BeaconBlock", sszType.serialize(data), sszType.hashTreeRoot(data), suffix);
    }
  }

  /**
   * Invalid state root error is critical and it causes the node to stale most of the time so we want to always
   * persist preState, postState and block for further investigation.
   */
  async persistInvalidStateRoot(
    preState: IBeaconStateView,
    postState: IBeaconStateView,
    block: SignedBeaconBlock
  ): Promise<void> {
    const blockSlot = block.message.slot;
    const blockType = this.config.getForkTypes(blockSlot).SignedBeaconBlock;
    const postStateRoot = postState.hashTreeRoot();
    const logStr = `slot_${blockSlot}_invalid_state_root_${toRootHex(postStateRoot)}`;
    await Promise.all([
      this.persistSszObject(
        `SignedBeaconBlock_slot_${blockSlot}`,
        blockType.serialize(block),
        blockType.hashTreeRoot(block),
        `${logStr}_block`
      ),
      this.persistSszObject(
        `preState_slot_${preState.slot}_BeaconState`,
        preState.serialize(),
        preState.hashTreeRoot(),
        `${logStr}_pre_state`
      ),
      this.persistSszObject(
        `postState_slot_${postState.slot}_BeaconState`,
        postState.serialize(),
        postState.hashTreeRoot(),
        `${logStr}_post_state`
      ),
    ]);
  }

  persistInvalidSszValue<T>(type: Type<T>, sszObject: T, suffix?: string): void {
    if (this.opts.persistInvalidSszObjects) {
      void this.persistSszObject(type.typeName, type.serialize(sszObject), type.hashTreeRoot(sszObject), suffix);
    }
  }

  persistInvalidSszBytes(typeName: string, sszBytes: Uint8Array, suffix?: string): void {
    if (this.opts.persistInvalidSszObjects) {
      void this.persistSszObject(typeName, sszBytes, sszBytes, suffix);
    }
  }

  private async persistSszObject(prefix: string, bytes: Uint8Array, root: Uint8Array, logStr?: string): Promise<void> {
    const now = new Date();
    // yyyy-MM-dd
    const dateStr = now.toISOString().split("T")[0];

    // by default store to lodestar_archive of current dir
    const dirpath = path.join(this.opts.persistInvalidSszObjectsDir ?? "invalid_ssz_objects", dateStr);
    const filepath = path.join(dirpath, `${prefix}_${toRootHex(root)}.ssz`);

    await ensureDir(dirpath);

    // as of Feb 17 2022 there are a lot of duplicate files stored with different date suffixes
    // remove date suffixes in file name, and check duplicate to avoid redundant persistence
    await writeIfNotExist(filepath, bytes);

    this.logger.debug("Persisted invalid ssz object", {id: logStr, filepath});
  }

  private onScrapeMetrics(metrics: Metrics): void {
    // All op-pool sizes are reported by the engine (the pools are engine-internal).
    metrics.chain.blacklistedBlocks.set(this.blacklistedBlocks.size);

    const headState = this.getHeadState();
    if (isStatePostElectra(headState)) {
      metrics.pendingDeposits.set(headState.pendingDepositsCount);
      metrics.pendingPartialWithdrawals.set(headState.pendingPartialWithdrawalsCount);
      metrics.pendingConsolidations.set(headState.pendingConsolidationsCount);
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

    const metrics = this.metrics;
    if (metrics && (slot + 1) % SLOTS_PER_EPOCH === 0) {
      // On the last slot of the epoch
      sleep(this.config.SLOT_DURATION_MS / 2)
        .then(() => this.validatorMonitor?.onceEveryEndOfEpoch(this.getHeadState()))
        .catch((e) => {
          if (!isErrorAborted(e)) this.logger.error("Error on validator monitor onceEveryEndOfEpoch", {slot}, e);
        });
    }
  }

  private onClockEpoch(epoch: Epoch): void {
    this.metrics?.clockEpoch.set(epoch);
    // Engine-owned caches (seen-caches, seenBlockAttesters, beaconProposerCache) are pruned by the
    // engine's own clock listener; nothing epoch-scoped remains facade-side.
  }

  private onForkChoiceJustified(this: BeaconChain, cp: CheckpointWithHex): void {
    this.logger.verbose("Fork choice justified", {epoch: cp.epoch, root: cp.rootHex});
  }

  private onCheckpoint(this: BeaconChain, _checkpoint: phase0.Checkpoint, state: IBeaconStateView): void {
    // Defer to not block other checkpoint event handlers, which can cause lightclient update delays
    callInNextEventLoop(() => {
      this.beaconEngine.shufflingCache.processState(state);
    });
  }

  private async onForkChoiceFinalized(this: BeaconChain, cp: CheckpointWithHex): Promise<void> {
    this.logger.verbose("Fork choice finalized", {epoch: cp.epoch, root: cp.rootHex});

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
      const finalizedCheckpoint = this.beaconEngine.getFinalizedCheckpoint();
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

      const stateOrBytes = (await this.getStateOrBytesByCheckpoint(finalizedCheckpoint))?.state;
      if (!stateOrBytes) {
        // If even the state is not available, we cannot update the custody group count
        this.logger.debug("No finalized state or bytes available to update target custody group count", {
          finalizedEpoch: finalizedCheckpoint.epoch,
          finalizedRoot: finalizedCheckpoint.rootHex,
        });
        return;
      }

      if (stateOrBytes instanceof Uint8Array) {
        effectiveBalances = getEffectiveBalancesFromStateBytes(this.config, stateOrBytes, validatorIndices);
      } else {
        effectiveBalances = validatorIndices.map((index) => stateOrBytes.getValidator(index).effectiveBalance ?? 0);
      }
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

  updateBuilderStatus(clockSlot: Slot): void {
    const executionBuilder = this.executionBuilder;
    if (executionBuilder) {
      const {faultInspectionWindow, allowedFaults} = executionBuilder;
      const slotsPresent = this.beaconEngine.getSlotsPresent(clockSlot - faultInspectionWindow);
      const previousStatus = executionBuilder.status;
      const shouldEnable = slotsPresent >= Math.min(faultInspectionWindow - allowedFaults, clockSlot);

      executionBuilder.updateStatus(shouldEnable ? BuilderStatus.enabled : BuilderStatus.circuitBreaker);
      // The status changed we should log
      const status = executionBuilder.status;
      const builderLog = {
        status,
        slotsPresent,
        faultInspectionWindow,
        allowedFaults,
      };
      if (status !== previousStatus) {
        this.logger.info("External builder status updated", builderLog);
      } else {
        this.logger.verbose("External builder status", builderLog);
      }
    }
  }

  async getBlockRewards(block: BeaconBlock | BlindedBeaconBlock): Promise<rewards.BlockRewards> {
    let preState = this.regen.getPreStateSync(block);

    if (preState === null) {
      throw Error(`Pre-state is unavailable given block's parent root ${toRootHex(block.parentRoot)}`);
    }

    preState = preState.processSlots(block.slot); // Dial preState's slot to block.slot

    const proposerRewards = this.regen.getStateSync(toRootHex(block.stateRoot))?.proposerRewards ?? undefined;

    return preState.computeBlockRewards(block, proposerRewards);
  }

  async getAttestationsRewards(
    epoch: Epoch,
    validatorIds?: (ValidatorIndex | string)[]
  ): Promise<{rewards: rewards.AttestationsRewards; executionOptimistic: boolean; finalized: boolean}> {
    // We use end slot of (epoch + 1) to ensure we have seen all attestations. On-time or late. Any late attestation beyond this slot is not considered
    const slot = computeEndSlotAtEpoch(epoch + 1);
    const stateResult = await this.getStateBySlot(slot, {allowRegen: false}); // No regen if state not in cache

    if (stateResult === null) {
      throw Error(`State is unavailable for slot ${slot}`);
    }

    const {executionOptimistic, finalized} = stateResult;
    const stateRoot = toRootHex(stateResult.state.hashTreeRoot());

    const cachedState = this.regen.getStateSync(stateRoot);

    if (cachedState === null) {
      throw Error(`State is not in cache for slot ${slot}`);
    }

    const rewards = await cachedState.computeAttestationsRewards(validatorIds);

    return {rewards, executionOptimistic, finalized};
  }

  async getSyncCommitteeRewards(
    block: BeaconBlock | BlindedBeaconBlock,
    validatorIds?: (ValidatorIndex | string)[]
  ): Promise<rewards.SyncCommitteeRewards> {
    let preState = this.regen.getPreStateSync(block);

    if (preState === null) {
      throw Error(`Pre-state is unavailable given block's parent root ${toRootHex(block.parentRoot)}`);
    }

    preState = preState.processSlots(block.slot); // Dial preState's slot to block.slot
    if (!isStatePostAltair(preState)) {
      throw new Error("Sync committee rewards are not supported before Altair");
    }

    return preState.computeSyncCommitteeRewards(block, validatorIds ?? []);
  }
}

/** Build a CheckpointWithHex from a ProtoBlock's `{epoch, rootHex}` checkpoint fields (no re-hashing). */
function protoCheckpointToWithHex(epoch: Epoch, rootHex: RootHex): CheckpointWithHex {
  return {epoch, root: fromHex(rootHex), rootHex};
}
