import path from "node:path";
import {type PubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {Type} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {BeaconConfig} from "@lodestar/config";
import {CheckpointWithHex} from "@lodestar/fork-choice";
import {LoggerNode} from "@lodestar/logger/node";
import {EFFECTIVE_BALANCE_INCREMENT, type ForkPostFulu, type ForkPostGloas, isForkPostGloas} from "@lodestar/params";
import {
  BeaconBlock,
  BlindedBeaconBlock,
  DataColumnSidecar,
  Epoch,
  Root,
  RootHex,
  Slot,
  Status,
  UintNum64,
  ValidatorIndex,
  deneb,
  gloas,
  isBlindedBeaconBlock,
  ssz,
  sszTypesFor,
} from "@lodestar/types";
import {Logger, fromHex, pruneSetToMax, toRootHex} from "@lodestar/utils";
import {ProcessShutdownCallback} from "@lodestar/validator";
import {GENESIS_EPOCH, ZERO_HASH} from "../constants/index.js";
import {IBeaconChainDb, IBeaconDb} from "../db/index.js";
import {BLOB_SIDECARS_IN_WRAPPER_INDEX} from "../db/repositories/blobSidecars.js";
import {decodeArchivedEnvelope} from "../db/repositories/index.js";
import {BuilderApiClient, BuilderApiClientOpts} from "../execution/builder/apiClient.js";
import {IExecutionEngine} from "../execution/index.js";
import {Metrics} from "../metrics/index.js";
import {ClockEvent, IClock} from "../util/clock.js";
import {CustodyConfig, getValidatorsCustodyRequirement} from "../util/dataColumns.js";
import {callInNextEventLoop} from "../util/eventLoop.js";
import {ReconstructMissPolicy, isRebuildMiss, reconstructExecutionPayloadEnvelopes} from "../util/execution.js";
import {JobItemQueue} from "../util/queue/itemQueue.js";
import {SerializedCache} from "../util/serializedCache.js";
import {getSlotFromSignedBeaconBlockSerialized} from "../util/sszBytes.js";
import {ArchiveStore} from "./archiveStore/archiveStore.js";
import {IBeaconEngine} from "./beaconEngine/index.js";
import {EngineBootstrap} from "./beaconEngine/initialization.js";
import type {FinalizedCheckpointSnapshot} from "./beaconEngine/interface.js";
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
import {ChainEvent, ChainEventEmitter} from "./emitter.js";
import {GetBlobsTracker} from "./GetBlobsTracker.js";
import {IBeaconChain, ProposerPreparationData} from "./interface.js";
import {IChainOptions} from "./options.js";
import {PrepareNextSlotScheduler} from "./prepareNextSlot.js";
import {ProduceResult} from "./produceBlock/index.js";
import {ReprocessController} from "./reprocess.js";
import {PayloadEnvelopeInput, SeenPayloadEnvelopeInput} from "./seenCache/index.js";
import {SeenBlockInput} from "./seenCache/seenGossipBlockInput.js";

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
  serializedCache: SerializedCache;
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
  beaconEngine: IBeaconEngine;
  /** Shared in-process client; omitted when the facade needs its own worker-mode client. */
  builderApiClient?: BuilderApiClient;
  builderApiClientOpts?: BuilderApiClientOpts;
  anchor: EngineBootstrap;
  earliestAvailableSlot: Slot;
  clock: IClock;
  emitter: ChainEventEmitter;
  custodyConfig: CustodyConfig;
};

export class BeaconChain implements IBeaconChain {
  readonly genesisTime: UintNum64;
  readonly genesisValidatorsRoot: Root;
  readonly beaconEngine: IBeaconEngine;
  readonly executionEngine: IExecutionEngine;

  readonly builderApiClient: BuilderApiClient;
  // Expose config for convenience in modularized functions
  readonly config: BeaconConfig;
  readonly custodyConfig: CustodyConfig;
  readonly logger: Logger;
  readonly metrics: Metrics | null;

  readonly anchorStateLatestBlockSlot: Slot;

  // Facade-local verification for pre-Gloas sidecars and builder request authentication in worker mode.
  readonly bls: IBlsVerifier;
  readonly clock: IClock;
  readonly emitter: ChainEventEmitter;
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
      beaconEngine,
      anchor,
      clock,
      emitter,
      custodyConfig,
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
    const signal = this.abortController.signal;
    this.custodyConfig = custodyConfig;
    this.serializedCache = modules.serializedCache;
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
    this.beaconEngine = beaconEngine;
    this.builderApiClient =
      modules.builderApiClient ??
      new BuilderApiClient(modules.builderApiClientOpts ?? {}, config, clock, this.bls, metrics, logger, (url) =>
        // Register preference-authenticated URLs in the engine before its pre-slot connection checks.
        beaconEngine.registerAuthenticatedBuilder(url)
      );
    this.blacklistedBlocks = new Map((opts.blacklistedBlocks ?? []).map((hex) => [hex, null]));

    this._earliestAvailableSlot = modules.earliestAvailableSlot;

    // Global cache of validators pubkey/index mapping
    this.pubkeyCache = pubkeyCache;

    const {checkpoint} = anchor;

    this.reprocessController = new ReprocessController(this.metrics);

    this.blockProcessor = new BlockProcessor(this, metrics, opts, signal);
    this.payloadEnvelopeProcessor = new PayloadEnvelopeProcessor(this, metrics, signal);

    this.seenPayloadEnvelopeInputCache = new SeenPayloadEnvelopeInput({
      config,
      clock,
      chainView: beaconEngine.chainView,
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
    this.emitter.on(ChainEvent.earliestAvailableSlotUpdated, this.onEarliestAvailableSlotUpdated);
    this.emitter.on(ChainEvent.fatalError, this.onEngineFatalError);
    if (!modules.builderApiClient) this.emitter.on(ChainEvent.builderRegistered, this.onBuilderRegistered);

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
      metrics.headSlot.addCollect(() => metrics.headSlot.set(this.beaconEngine.chainView.getHead().slot));
    }

    clock.addListener(ClockEvent.slot, this.clockSlotListener);
    clock.addListener(ClockEvent.epoch, this.clockEpochListener);
    emitter.addListener(ChainEvent.forkChoiceFinalized, this.onForkChoiceFinalized.bind(this));
    emitter.addListener(ChainEvent.forkChoiceJustified, this.onForkChoiceJustified.bind(this));
  }

  private onEarliestAvailableSlotUpdated = (slot: Slot): void => {
    this.earliestAvailableSlot = Math.max(this.earliestAvailableSlot, slot);
  };

  async init(): Promise<void> {
    await this.archiveStore.init();
    await this.loadFromDisk();
  }

  async close(): Promise<void> {
    this.clock.off(ClockEvent.slot, this.clockSlotListener);
    this.clock.off(ClockEvent.epoch, this.clockEpochListener);
    // Engine owns teardown of its resources (historical-state regen + BLS pool).
    await this.beaconEngine.close();
    await this.bls.close();
    this.emitter.off(ChainEvent.earliestAvailableSlotUpdated, this.onEarliestAvailableSlotUpdated);
    this.emitter.off(ChainEvent.fatalError, this.onEngineFatalError);
    this.emitter.off(ChainEvent.builderRegistered, this.onBuilderRegistered);

    // Since we don't persist unfinalized fork-choice,
    // we can abort any ongoing unfinalized block writes.
    // TODO: persist fork choice to disk and allow unfinalized block writes to complete.
    this.unfinalizedBlockWrites.dropAllJobs();
    this.unfinalizedPayloadEnvelopeWrites.dropAllJobs();

    this.abortController.abort();
  }

  seenBlock(blockRoot: RootHex): boolean {
    return (
      this.seenBlockInputCache.hasBlock(blockRoot) ||
      this.seenBlockInputCache.isValidatingBlock(blockRoot) ||
      this.beaconEngine.chainView.hasBlockHexUnsafe(blockRoot)
    );
  }

  seenPayloadEnvelope(blockRoot: RootHex): boolean {
    return (
      this.seenPayloadEnvelopeInputCache.hasPayload(blockRoot) ||
      this.beaconEngine.chainView.hasPayloadHexUnsafe(blockRoot)
    );
  }

  beaconEngineRegenCanAcceptWork(): boolean {
    return this.beaconEngine.regenCanAcceptWork();
  }

  beaconEngineBlsThreadPoolCanAcceptWork(): boolean {
    return this.beaconEngine.blsThreadPoolCanAcceptWork();
  }

  validatorSeenAtEpoch(index: ValidatorIndex, epoch: Epoch): Promise<boolean> {
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

  /**
   * [beacon-engine] Unlike unstable, omit execution status (executionOptimistic) and finalized metadata:
   * P2P handlers only need block bytes and slot.
   */
  async getSerializedBlockByRoot(root: Uint8Array): Promise<{block: Uint8Array; slot: Slot} | null> {
    const rootHex = toRootHex(root);
    const protoBlock = this.beaconEngine.chainView.getBlockHexDefaultStatus(rootHex);
    if (protoBlock) {
      // Block found in ChainView.
      // It may be in the block input cache, awaiting full DA reconstruction, check there first
      // Otherwise (most likely), read the hot db (falling back to cold on an archive race)
      const blockInput = this.seenBlockInputCache.get(protoBlock.blockRoot);
      if (blockInput?.hasBlock()) {
        const signedBlock = blockInput.getBlock();
        return {
          block:
            this.serializedCache.get(signedBlock) ??
            this.config.getForkTypes(blockInput.slot).SignedBeaconBlock.serialize(signedBlock),
          slot: blockInput.slot,
        };
      }
    }

    const hot = await this.db.block.getBinary(root);
    if (hot) {
      const slot = getSlotFromSignedBeaconBlockSerialized(hot);
      if (slot === null) throw Error(`Invalid block data stored in DB for root: ${toRootHex(root)}`);
      return {block: hot, slot};
    }
    const cold = await this.db.blockArchive.getBinaryEntryByRoot(root);
    return cold && {block: cold.value, slot: cold.key};
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

  getStatus(): Status {
    const head = this.beaconEngine.chainView.getHead();
    const finalizedCheckpoint = this.beaconEngine.chainView.getFinalizedCheckpoint();
    const boundary = this.config.getForkBoundaryAtEpoch(this.clock.currentEpoch);
    return {
      // fork_digest: The node's ForkDigest (compute_fork_digest(current_fork_version, genesis_validators_root)) where
      // - current_fork_version is the fork version at the node's current epoch defined by the wall-clock time (not necessarily the epoch to which the node is sync)
      // - genesis_validators_root is the static Root found in state.genesis_validators_root
      // - epoch of fork boundary is used to get blob parameters of current Blob Parameter Only (BPO) fork
      forkDigest: this.config.forkBoundary2ForkDigest(boundary),
      // finalized_root: state.finalized_checkpoint.root for the state corresponding to the head block (Note this defaults to Root(b'\x00' * 32) for the genesis finalized checkpoint).
      finalizedRoot: finalizedCheckpoint.epoch === GENESIS_EPOCH ? ZERO_HASH : finalizedCheckpoint.root,
      finalizedEpoch: finalizedCheckpoint.epoch,
      // TODO: PERFORMANCE: Memoize to prevent re-computing every time
      headRoot: fromHex(head.blockRoot),
      headSlot: head.slot,
      earliestAvailableSlot: this._earliestAvailableSlot,
    };
  }

  private onBuilderRegistered = (url: string): void => {
    this.builderApiClient.registerAuthenticatedBuilder(url);
  };

  private onEngineFatalError = (error: Error): void => {
    this.processShutdownCallback(error);
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
  }

  private readonly clockSlotListener = this.onClockSlot.bind(this);
  private readonly clockEpochListener = this.onClockEpoch.bind(this);

  private onClockSlot(slot: Slot): void {
    this.logger.verbose("Clock slot", {slot});

    // CRITICAL UPDATE
    this.beaconEngine.onSlot(slot).catch((e) => {
      this.logger.error("Error processing beacon engine slot", {slot}, e);
    });
    this.metrics?.clockSlot.set(slot);
    this.reprocessController.onSlot(slot);

    // Prune old cached block production artifacts, those are only useful on their slot
    pruneSetToMax(this.blockProductionCache, this.opts.maxCachedProducedRoots ?? DEFAULT_MAX_CACHED_PRODUCED_RESULTS);
    this.metrics?.blockProductionCacheSize.set(this.blockProductionCache.size);
  }

  private onClockEpoch(epoch: Epoch): void {
    this.metrics?.clockEpoch.set(epoch);
    this.beaconEngine.onEpoch(epoch).catch((e) => {
      this.logger.error("Error running beacon engine epoch maintenance", {epoch}, e);
    });
  }

  private onForkChoiceJustified(this: BeaconChain, cp: CheckpointWithHex): void {
    this.logger.verbose("Fork choice justified", {epoch: cp.epoch, root: cp.rootHex});
  }

  private async onForkChoiceFinalized(
    this: BeaconChain,
    cp: FinalizedCheckpointSnapshot & {rootHex: RootHex}
  ): Promise<void> {
    this.logger.verbose("Fork choice finalized", {epoch: cp.epoch, root: cp.rootHex});
    this.metrics?.finalizedEpoch.set(cp.epoch);
    const event = {
      block: cp.rootHex,
      epoch: cp.epoch,
      state: toRootHex(cp.stateRoot),
      executionOptimistic: cp.executionOptimistic,
    };
    callInNextEventLoop(() => this.emitter.emit(routes.events.EventType.finalizedCheckpoint, event));

    // Engine prunes proposer observations in pruneOnFinalized below.

    // Update validator custody to account for effective balance changes
    await this.updateValidatorsCustodyRequirement({epoch: cp.epoch, root: cp.root, rootHex: cp.rootHex});

    // Engine prunes its own op pool + seen-block-proposers on finalization.
    await this.beaconEngine.pruneOnFinalized();
  }

  async updateBeaconProposerData(epoch: Epoch, proposers: ProposerPreparationData[]): Promise<void> {
    // Engine owns the proposer cache; it returns whether new validators were discovered.
    const discoveredNewValidators = await this.beaconEngine.updateProposerPreparation(epoch, proposers);

    // Only update validator custody if we discovered new validators
    if (discoveredNewValidators) {
      const finalizedCheckpoint = this.beaconEngine.chainView.getFinalizedCheckpoint();
      await this.updateValidatorsCustodyRequirement(finalizedCheckpoint);
    }
  }

  async updateAttachedValidators(epoch: Epoch, validatorIndices: ValidatorIndex[]): Promise<void> {
    const hasNewValidators = await this.beaconEngine.trackAttachedValidators(epoch, validatorIndices);

    // Only update validator custody if we discovered new validators
    if (hasNewValidators) {
      const finalizedCheckpoint = this.beaconEngine.chainView.getFinalizedCheckpoint();
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
    const validatorIndices = await this.beaconEngine.getProposerCacheValidatorIndices();

    // Update custody requirement based on finalized state
    let effectiveBalances: number[];
    const effectiveBalanceIncrements = await this.beaconEngine.getCheckpointEffectiveBalances(finalizedCheckpoint);
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
