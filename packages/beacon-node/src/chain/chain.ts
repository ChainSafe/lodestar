import path from "node:path";
import {PrivateKey} from "@libp2p/interface";
import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {CompositeTypeAny, TreeView, Type} from "@chainsafe/ssz";
import {BeaconConfig} from "@lodestar/config";
import {CheckpointWithHex, ExecutionStatus, IForkChoice, ProtoBlock, UpdateHeadOpt} from "@lodestar/fork-choice";
import {LoggerNode} from "@lodestar/logger/node";
import {EFFECTIVE_BALANCE_INCREMENT, GENESIS_SLOT, SLOTS_PER_EPOCH, isForkPostElectra} from "@lodestar/params";
import {
  BeaconStateAllForks,
  BeaconStateElectra,
  CachedBeaconStateAllForks,
  EffectiveBalanceIncrements,
  EpochShuffling,
  Index2PubkeyCache,
  computeAnchorCheckpoint,
  computeEndSlotAtEpoch,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  createCachedBeaconState,
  getEffectiveBalanceIncrementsZeroInactive,
  getEffectiveBalancesFromStateBytes,
  isCachedBeaconState,
  processSlots,
} from "@lodestar/state-transition";
import {
  BeaconBlock,
  BlindedBeaconBlock,
  BlindedBeaconBlockBody,
  Epoch,
  Root,
  RootHex,
  SignedBeaconBlock,
  Slot,
  Status,
  UintNum64,
  ValidatorIndex,
  Wei,
  isBlindedBeaconBlock,
  phase0,
} from "@lodestar/types";
import {Logger, fromHex, gweiToWei, isErrorAborted, pruneSetToMax, sleep, toRootHex} from "@lodestar/utils";
import {ProcessShutdownCallback} from "@lodestar/validator";
import {GENESIS_EPOCH, ZERO_HASH} from "../constants/index.js";
import {IBeaconDb} from "../db/index.js";
import {IEth1ForBlockProduction} from "../eth1/index.js";
import {BuilderStatus} from "../execution/builder/http.js";
import {IExecutionBuilder, IExecutionEngine} from "../execution/index.js";
import {Metrics} from "../metrics/index.js";
import {computeNodeIdFromPrivateKey} from "../network/subnets/interface.js";
import {BufferPool} from "../util/bufferPool.js";
import {Clock, ClockEvent, IClock} from "../util/clock.js";
import {CustodyConfig, getValidatorsCustodyRequirement} from "../util/dataColumns.js";
import {ensureDir, writeIfNotExist} from "../util/file.js";
import {isOptimisticBlock} from "../util/forkChoice.js";
import {SerializedCache} from "../util/serializedCache.js";
import {ArchiveStore} from "./archiveStore/archiveStore.js";
import {CheckpointBalancesCache} from "./balancesCache.js";
import {BeaconProposerCache} from "./beaconProposerCache.js";
import {IBlockInput} from "./blocks/blockInput/index.js";
import {BlockProcessor, ImportBlockOpts} from "./blocks/index.js";
import {BlsMultiThreadWorkerPool, BlsSingleThreadVerifier, IBlsVerifier} from "./bls/index.js";
import {ColumnReconstructionTracker} from "./ColumnReconstructionTracker.js";
import {ChainEvent, ChainEventEmitter} from "./emitter.js";
import {ForkchoiceCaller, initializeForkChoice} from "./forkChoice/index.js";
import {GetBlobsTracker} from "./GetBlobsTracker.js";
import {CommonBlockBody, FindHeadFnName, IBeaconChain, ProposerPreparationData, StateGetOpts} from "./interface.js";
import {LightClientServer} from "./lightClient/index.js";
import {
  AggregatedAttestationPool,
  AttestationPool,
  OpPool,
  SyncCommitteeMessagePool,
  SyncContributionAndProofPool,
} from "./opPools/index.js";
import {IChainOptions} from "./options.js";
import {PrepareNextSlotScheduler} from "./prepareNextSlot.js";
import {computeNewStateRoot} from "./produceBlock/computeNewStateRoot.js";
import {AssembledBlockType, BlockType, ProduceResult} from "./produceBlock/index.js";
import {BlockAttributes, produceBlockBody, produceCommonBlockBody} from "./produceBlock/produceBlockBody.js";
import {QueuedStateRegenerator, RegenCaller} from "./regen/index.js";
import {ReprocessController} from "./reprocess.js";
import {AttestationsRewards, computeAttestationsRewards} from "./rewards/attestationsRewards.js";
import {BlockRewards, computeBlockRewards} from "./rewards/blockRewards.js";
import {SyncCommitteeRewards, computeSyncCommitteeRewards} from "./rewards/syncCommitteeRewards.js";
import {
  SeenAggregators,
  SeenAttesters,
  SeenBlockProposers,
  SeenContributionAndProof,
  SeenSyncCommitteeMessages,
} from "./seenCache/index.js";
import {SeenAggregatedAttestations} from "./seenCache/seenAggregateAndProof.js";
import {SeenAttestationDatas} from "./seenCache/seenAttestationData.js";
import {SeenBlockAttesters} from "./seenCache/seenBlockAttesters.js";
import {SeenBlockInput} from "./seenCache/seenGossipBlockInput.js";
import {ShufflingCache} from "./shufflingCache.js";
import {BlockStateCacheImpl} from "./stateCache/blockStateCacheImpl.js";
import {DbCPStateDatastore, checkpointToDatastoreKey} from "./stateCache/datastore/db.js";
import {FileCPStateDatastore} from "./stateCache/datastore/file.js";
import {CPStateDatastore} from "./stateCache/datastore/types.js";
import {FIFOBlockStateCache} from "./stateCache/fifoBlockStateCache.js";
import {InMemoryCheckpointStateCache} from "./stateCache/inMemoryCheckpointsCache.js";
import {PersistentCheckpointStateCache} from "./stateCache/persistentCheckpointsCache.js";
import {CheckpointStateCache} from "./stateCache/types.js";
import {ValidatorMonitor} from "./validatorMonitor.js";

/**
 * The maximum number of cached produced results to keep in memory.
 *
 * Arbitrary constant. Blobs and payloads should be consumed immediately in the same slot
 * they are produced. A value of 1 would probably be sufficient. However it's sensible to
 * allow some margin if the node overloads.
 */
const DEFAULT_MAX_CACHED_PRODUCED_RESULTS = 4;

export class BeaconChain implements IBeaconChain {
  readonly genesisTime: UintNum64;
  readonly genesisValidatorsRoot: Root;
  readonly eth1: IEth1ForBlockProduction;
  readonly executionEngine: IExecutionEngine;
  readonly executionBuilder?: IExecutionBuilder;
  // Expose config for convenience in modularized functions
  readonly config: BeaconConfig;
  readonly custodyConfig: CustodyConfig;
  readonly logger: Logger;
  readonly metrics: Metrics | null;
  readonly validatorMonitor: ValidatorMonitor | null;
  readonly bufferPool: BufferPool | null;

  readonly anchorStateLatestBlockSlot: Slot;

  readonly bls: IBlsVerifier;
  readonly forkChoice: IForkChoice;
  readonly clock: IClock;
  readonly emitter: ChainEventEmitter;
  readonly regen: QueuedStateRegenerator;
  readonly lightClientServer?: LightClientServer;
  readonly reprocessController: ReprocessController;
  readonly archiveStore: ArchiveStore;

  // Ops pool
  readonly attestationPool: AttestationPool;
  readonly aggregatedAttestationPool: AggregatedAttestationPool;
  readonly syncCommitteeMessagePool: SyncCommitteeMessagePool;
  readonly syncContributionAndProofPool;
  readonly opPool = new OpPool();

  // Gossip seen cache
  readonly seenAttesters = new SeenAttesters();
  readonly seenAggregators = new SeenAggregators();
  readonly seenAggregatedAttestations: SeenAggregatedAttestations;
  readonly seenBlockProposers = new SeenBlockProposers();
  readonly seenSyncCommitteeMessages = new SeenSyncCommitteeMessages();
  readonly seenContributionAndProof: SeenContributionAndProof;
  readonly seenAttestationDatas: SeenAttestationDatas;
  readonly seenBlockInputCache: SeenBlockInput;
  // Seen cache for liveness checks
  readonly seenBlockAttesters = new SeenBlockAttesters();

  // Global state caches
  readonly pubkey2index: PubkeyIndexMap;
  readonly index2pubkey: Index2PubkeyCache;

  readonly beaconProposerCache: BeaconProposerCache;
  readonly checkpointBalancesCache: CheckpointBalancesCache;
  readonly shufflingCache: ShufflingCache;

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
  protected readonly db: IBeaconDb;
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
      eth1,
      executionEngine,
      executionBuilder,
    }: {
      privateKey: PrivateKey;
      config: BeaconConfig;
      db: IBeaconDb;
      dbName: string;
      dataDir: string;
      logger: Logger;
      processShutdownCallback: ProcessShutdownCallback;
      /** Used for testing to supply fake clock */
      clock?: IClock;
      metrics: Metrics | null;
      validatorMonitor: ValidatorMonitor | null;
      anchorState: BeaconStateAllForks;
      isAnchorStateFinalized: boolean;
      eth1: IEth1ForBlockProduction;
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
    this.eth1 = eth1;
    this.executionEngine = executionEngine;
    this.executionBuilder = executionBuilder;
    const signal = this.abortController.signal;
    const emitter = new ChainEventEmitter();
    // by default, verify signatures on both main threads and worker threads
    const bls = opts.blsVerifyAllMainThread
      ? new BlsSingleThreadVerifier({metrics})
      : new BlsMultiThreadWorkerPool(opts, {logger, metrics});

    if (!clock) clock = new Clock({config, genesisTime: this.genesisTime, signal});

    this.blacklistedBlocks = new Map((opts.blacklistedBlocks ?? []).map((hex) => [hex, null]));
    this.attestationPool = new AttestationPool(config, clock, this.opts?.preaggregateSlotDistance, metrics);
    this.aggregatedAttestationPool = new AggregatedAttestationPool(this.config, metrics);
    this.syncCommitteeMessagePool = new SyncCommitteeMessagePool(config, clock, this.opts?.preaggregateSlotDistance);
    this.syncContributionAndProofPool = new SyncContributionAndProofPool(config, clock, metrics, logger);

    this.seenAggregatedAttestations = new SeenAggregatedAttestations(metrics);
    this.seenContributionAndProof = new SeenContributionAndProof(metrics);
    this.seenAttestationDatas = new SeenAttestationDatas(metrics, this.opts?.attDataCacheSlotDistance);

    const nodeId = computeNodeIdFromPrivateKey(privateKey);
    const initialCustodyGroupCount = opts.initialCustodyGroupCount ?? config.CUSTODY_REQUIREMENT;
    this.metrics?.peerDas.targetCustodyGroupCount.set(initialCustodyGroupCount);
    this.custodyConfig = new CustodyConfig({
      nodeId,
      config,
      initialCustodyGroupCount,
    });

    this.beaconProposerCache = new BeaconProposerCache(opts);
    this.checkpointBalancesCache = new CheckpointBalancesCache();
    this.seenBlockInputCache = new SeenBlockInput({
      config,
      custodyConfig: this.custodyConfig,
      clock,
      chainEvents: emitter,
      signal,
      metrics,
      logger,
    });

    // Restore state caches
    // anchorState may already by a CachedBeaconState. If so, don't create the cache again, since deserializing all
    // pubkeys takes ~30 seconds for 350k keys (mainnet 2022Q2).
    // When the BeaconStateCache is created in eth1 genesis builder it may be incorrect. Until we can ensure that
    // it's safe to re-use _ANY_ BeaconStateCache, this option is disabled by default and only used in tests.
    const cachedState =
      isCachedBeaconState(anchorState) && opts.skipCreateStateCacheIfAvailable
        ? anchorState
        : createCachedBeaconState(anchorState, {
            config,
            pubkey2index: new PubkeyIndexMap(),
            index2pubkey: [],
          });
    this._earliestAvailableSlot = cachedState.slot;

    this.shufflingCache = cachedState.epochCtx.shufflingCache = new ShufflingCache(metrics, logger, this.opts, [
      {
        shuffling: cachedState.epochCtx.previousShuffling,
        decisionRoot: cachedState.epochCtx.previousDecisionRoot,
      },
      {
        shuffling: cachedState.epochCtx.currentShuffling,
        decisionRoot: cachedState.epochCtx.currentDecisionRoot,
      },
      {
        shuffling: cachedState.epochCtx.nextShuffling,
        decisionRoot: cachedState.epochCtx.nextDecisionRoot,
      },
    ]);

    // Persist single global instance of state caches
    this.pubkey2index = cachedState.epochCtx.pubkey2index;
    this.index2pubkey = cachedState.epochCtx.index2pubkey;

    const fileDataStore = opts.nHistoricalStatesFileDataStore ?? true;
    const blockStateCache = this.opts.nHistoricalStates
      ? new FIFOBlockStateCache(this.opts, {metrics})
      : new BlockStateCacheImpl({metrics});
    this.bufferPool = this.opts.nHistoricalStates
      ? new BufferPool(anchorState.type.tree_serializedSize(anchorState.node), metrics)
      : null;

    let checkpointStateCache: CheckpointStateCache;
    this.cpStateDatastore = undefined;
    if (this.opts.nHistoricalStates) {
      this.cpStateDatastore = fileDataStore ? new FileCPStateDatastore(dataDir) : new DbCPStateDatastore(this.db);
      checkpointStateCache = new PersistentCheckpointStateCache(
        {
          metrics,
          logger,
          clock,
          blockStateCache,
          bufferPool: this.bufferPool,
          datastore: this.cpStateDatastore,
        },
        this.opts
      );
    } else {
      checkpointStateCache = new InMemoryCheckpointStateCache({metrics});
    }

    const {checkpoint} = computeAnchorCheckpoint(config, anchorState);
    blockStateCache.add(cachedState);
    blockStateCache.setHeadState(cachedState);
    checkpointStateCache.add(checkpoint, cachedState);

    const forkChoice = initializeForkChoice(
      config,
      emitter,
      clock.currentSlot,
      cachedState,
      isAnchorStateFinalized,
      opts,
      this.justifiedBalancesGetter.bind(this),
      metrics,
      logger
    );
    const regen = new QueuedStateRegenerator({
      config,
      forkChoice,
      blockStateCache,
      checkpointStateCache,
      db,
      metrics,
      validatorMonitor,
      logger,
      emitter,
      signal,
    });

    if (!opts.disableLightClientServer) {
      this.lightClientServer = new LightClientServer(opts, {config, clock, db, metrics, emitter, logger});
    }

    this.reprocessController = new ReprocessController(this.metrics);

    this.blockProcessor = new BlockProcessor(this, metrics, opts, signal);

    this.forkChoice = forkChoice;
    this.clock = clock;
    this.regen = regen;
    this.bls = bls;
    this.emitter = emitter;

    this.serializedCache = new SerializedCache();

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

    // Stop polling eth1 data if anchor state is in Electra AND deposit_requests_start_index is reached
    const anchorStateFork = this.config.getForkName(anchorState.slot);
    if (isForkPostElectra(anchorStateFork)) {
      const {eth1DepositIndex, depositRequestsStartIndex} = anchorState as BeaconStateElectra;
      if (eth1DepositIndex === Number(depositRequestsStartIndex)) {
        this.eth1.stopPollingEth1Data();
      }
    }

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
    await this.archiveStore.close();
    await this.bls.close();
    this.abortController.abort();
  }

  seenBlock(blockRoot: RootHex): boolean {
    return this.seenBlockInputCache.has(blockRoot) || this.forkChoice.hasBlockHex(blockRoot);
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

    return (
      // Dedicated cache for liveness checks, registers attesters seen through blocks.
      // Note: this check should be cheaper + overlap with counting participants of aggregates from gossip.
      this.seenBlockAttesters.isKnown(epoch, index) ||
      //
      // Re-use gossip caches. Populated on validation of gossip + API messages
      //   seenAttesters = single signer of unaggregated attestations
      this.seenAttesters.isKnown(epoch, index) ||
      //   seenAggregators = single aggregator index, not participants of the aggregate
      this.seenAggregators.isKnown(epoch, index) ||
      //   seenBlockProposers = single block proposer
      this.seenBlockProposers.seenAtEpoch(epoch, index)
    );
  }

  /** Populate in-memory caches with persisted data. Call at least once on startup */
  async loadFromDisk(): Promise<void> {
    await this.regen.init();
    await this.opPool.fromPersisted(this.db);
  }

  /** Persist in-memory data to the DB. Call at least once before stopping the process */
  async persistToDisk(): Promise<void> {
    await this.archiveStore.persistToDisk();
    await this.opPool.toPersisted(this.db);
  }

  getHeadState(): CachedBeaconStateAllForks {
    // head state should always exist
    const head = this.forkChoice.getHead();
    const headState = this.regen.getClosestHeadState(head);
    if (!headState) {
      throw Error(`headState does not exist for head root=${head.blockRoot} slot=${head.slot}`);
    }
    return headState;
  }

  async getHeadStateAtCurrentEpoch(regenCaller: RegenCaller): Promise<CachedBeaconStateAllForks> {
    return this.getHeadStateAtEpoch(this.clock.currentEpoch, regenCaller);
  }

  async getHeadStateAtEpoch(epoch: Epoch, regenCaller: RegenCaller): Promise<CachedBeaconStateAllForks> {
    // using getHeadState() means we'll use checkpointStateCache if it's available
    const headState = this.getHeadState();
    // head state is in the same epoch, or we pulled up head state already from past epoch
    if (epoch <= computeEpochAtSlot(headState.slot)) {
      // should go to this most of the time
      return headState;
    }
    // only use regen queue if necessary, it'll cache in checkpointStateCache if regen gets through epoch transition
    const head = this.forkChoice.getHead();
    const startSlot = computeStartSlotAtEpoch(epoch);
    return this.regen.getBlockSlotState(head.blockRoot, startSlot, {dontTransferCache: true}, regenCaller);
  }

  async getStateBySlot(
    slot: Slot,
    opts?: StateGetOpts
  ): Promise<{state: BeaconStateAllForks; executionOptimistic: boolean; finalized: boolean} | null> {
    const finalizedBlock = this.forkChoice.getFinalizedBlock();

    if (slot < finalizedBlock.slot) {
      // request for finalized state not supported in this API
      // fall back to caller to look in db or getHistoricalStateBySlot
      return null;
    }

    if (opts?.allowRegen) {
      // Find closest canonical block to slot, then trigger regen
      const block = this.forkChoice.getCanonicalBlockClosestLteSlot(slot) ?? finalizedBlock;
      const state = await this.regen.getBlockSlotState(
        block.blockRoot,
        slot,
        {dontTransferCache: true},
        RegenCaller.restApi
      );
      return {
        state,
        executionOptimistic: isOptimisticBlock(block),
        finalized: slot === finalizedBlock.slot && finalizedBlock.slot !== GENESIS_SLOT,
      };
    }

    // Just check if state is already in the cache. If it's not dialed to the correct slot,
    // do not bother in advancing the state. restApiCanTriggerRegen == false means do no work
    const block = this.forkChoice.getCanonicalBlockAtSlot(slot);
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
  ): Promise<{state: BeaconStateAllForks; executionOptimistic: boolean; finalized: boolean} | null> {
    if (opts?.allowRegen) {
      const state = await this.regen.getState(stateRoot, RegenCaller.restApi);
      const block = this.forkChoice.getBlock(state.latestBlockHeader.hashTreeRoot());
      const finalizedEpoch = this.forkChoice.getFinalizedCheckpoint().epoch;
      return {
        state,
        executionOptimistic: block != null && isOptimisticBlock(block),
        finalized: state.epochCtx.epoch <= finalizedEpoch && finalizedEpoch !== GENESIS_EPOCH,
      };
    }

    // TODO: This can only fulfill requests for a very narrow set of roots.
    // - very recent states that happen to be in the cache
    // - 1 every 100s of states that are persisted in the archive state

    // TODO: This is very inneficient for debug requests of serialized content, since it deserializes to serialize again
    const cachedStateCtx = this.regen.getStateSync(stateRoot);
    if (cachedStateCtx) {
      const block = this.forkChoice.getBlock(cachedStateCtx.latestBlockHeader.hashTreeRoot());
      const finalizedEpoch = this.forkChoice.getFinalizedCheckpoint().epoch;
      return {
        state: cachedStateCtx,
        executionOptimistic: block != null && isOptimisticBlock(block),
        finalized: cachedStateCtx.epochCtx.epoch <= finalizedEpoch && finalizedEpoch !== GENESIS_EPOCH,
      };
    }

    const data = await this.db.stateArchive.getByRoot(fromHex(stateRoot));
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

    const persistedKey = checkpointToDatastoreKey(checkpoint);
    return this.cpStateDatastore.read(persistedKey);
  }

  getStateByCheckpoint(
    checkpoint: CheckpointWithHex
  ): {state: BeaconStateAllForks; executionOptimistic: boolean; finalized: boolean} | null {
    // finalized or justified checkpoint states maynot be available with PersistentCheckpointStateCache, use getCheckpointStateOrBytes() api to get Uint8Array
    const cachedStateCtx = this.regen.getCheckpointStateSync(checkpoint);
    if (cachedStateCtx) {
      const block = this.forkChoice.getBlock(cachedStateCtx.latestBlockHeader.hashTreeRoot());
      const finalizedEpoch = this.forkChoice.getFinalizedCheckpoint().epoch;
      return {
        state: cachedStateCtx,
        executionOptimistic: block != null && isOptimisticBlock(block),
        finalized: cachedStateCtx.epochCtx.epoch <= finalizedEpoch && finalizedEpoch !== GENESIS_EPOCH,
      };
    }

    return null;
  }

  async getStateOrBytesByCheckpoint(
    checkpoint: CheckpointWithHex
  ): Promise<{state: CachedBeaconStateAllForks | Uint8Array; executionOptimistic: boolean; finalized: boolean} | null> {
    const cachedStateCtx = await this.regen.getCheckpointStateOrBytes(checkpoint);
    if (cachedStateCtx) {
      const block = this.forkChoice.getBlock(checkpoint.root);
      const finalizedEpoch = this.forkChoice.getFinalizedCheckpoint().epoch;
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
    const finalizedBlock = this.forkChoice.getFinalizedBlock();
    if (slot > finalizedBlock.slot) {
      // Unfinalized slot, attempt to find in fork-choice
      const block = this.forkChoice.getCanonicalBlockAtSlot(slot);
      if (block) {
        const data = await this.db.block.get(fromHex(block.blockRoot));
        if (data) {
          return {block: data, executionOptimistic: isOptimisticBlock(block), finalized: false};
        }
      }
      // A non-finalized slot expected to be found in the hot db, could be archived during
      // this function runtime, so if not found in the hot db, fallback to the cold db
      // TODO: Add a lock to the archiver to have determinstic behaviour on where are blocks
    }

    const data = await this.db.blockArchive.get(slot);
    return data && {block: data, executionOptimistic: false, finalized: true};
  }

  async getBlockByRoot(
    root: string
  ): Promise<{block: SignedBeaconBlock; executionOptimistic: boolean; finalized: boolean} | null> {
    const block = this.forkChoice.getBlockHex(root);
    if (block) {
      const data = await this.db.block.get(fromHex(root));
      if (data) {
        return {block: data, executionOptimistic: isOptimisticBlock(block), finalized: false};
      }
      // If block is not found in hot db, try cold db since there could be an archive cycle happening
      // TODO: Add a lock to the archiver to have deterministic behavior on where are blocks
    }

    const data = await this.db.blockArchive.getByRoot(fromHex(root));
    return data && {block: data, executionOptimistic: false, finalized: true};
  }

  async produceCommonBlockBody(blockAttributes: BlockAttributes): Promise<CommonBlockBody> {
    const {slot, parentBlockRoot} = blockAttributes;
    const state = await this.regen.getBlockSlotState(
      toRootHex(parentBlockRoot),
      slot,
      {dontTransferCache: true},
      RegenCaller.produceBlock
    );

    // TODO: To avoid breaking changes for metric define this attribute
    const blockType = BlockType.Full;

    return produceCommonBlockBody.call(this, blockType, state, blockAttributes);
  }

  produceBlock(blockAttributes: BlockAttributes & {commonBlockBodyPromise: Promise<CommonBlockBody>}): Promise<{
    block: BeaconBlock;
    executionPayloadValue: Wei;
    consensusBlockValue: Wei;
    shouldOverrideBuilder?: boolean;
  }> {
    return this.produceBlockWrapper<BlockType.Full>(BlockType.Full, blockAttributes);
  }

  produceBlindedBlock(blockAttributes: BlockAttributes & {commonBlockBodyPromise: Promise<CommonBlockBody>}): Promise<{
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
      parentBlockRoot,
    }: BlockAttributes & {commonBlockBodyPromise: Promise<CommonBlockBody>}
  ): Promise<{
    block: AssembledBlockType<T>;
    executionPayloadValue: Wei;
    consensusBlockValue: Wei;
    shouldOverrideBuilder?: boolean;
  }> {
    const state = await this.regen.getBlockSlotState(
      toRootHex(parentBlockRoot),
      slot,
      {dontTransferCache: true},
      RegenCaller.produceBlock
    );
    const proposerIndex = state.epochCtx.getBeaconProposer(slot);
    const proposerPubKey = this.index2pubkey[proposerIndex].toBytes();

    const {body, produceResult, executionPayloadValue, shouldOverrideBuilder} = await produceBlockBody.call(
      this,
      blockType,
      state,
      {
        randaoReveal,
        graffiti,
        slot,
        feeRecipient,
        parentBlockRoot,
        proposerIndex,
        proposerPubKey,
        commonBlockBodyPromise,
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
      parentRoot: parentBlockRoot,
      stateRoot: ZERO_HASH,
      body,
    } as AssembledBlockType<T>;

    const {newStateRoot, proposerReward} = computeNewStateRoot(this.metrics, state, block);
    block.stateRoot = newStateRoot;
    const blockRoot =
      produceResult.type === BlockType.Full
        ? this.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block)
        : this.config.getPostBellatrixForkTypes(slot).BlindedBeaconBlock.hashTreeRoot(block as BlindedBeaconBlock);
    const blockRootHex = toRootHex(blockRoot);

    // Track the produced block for consensus broadcast validations, later validation, etc.
    this.blockProductionCache.set(blockRootHex, produceResult);
    this.metrics?.blockProductionCacheSize.set(this.blockProductionCache.size);

    return {block, executionPayloadValue, consensusBlockValue: gweiToWei(proposerReward), shouldOverrideBuilder};
  }

  async processBlock(block: IBlockInput, opts?: ImportBlockOpts): Promise<void> {
    return this.blockProcessor.processBlocksJob([block], opts);
  }

  async processChainSegment(blocks: IBlockInput[], opts?: ImportBlockOpts): Promise<void> {
    return this.blockProcessor.processBlocksJob(blocks, opts);
  }

  getStatus(): Status {
    const head = this.forkChoice.getHead();
    const finalizedCheckpoint = this.forkChoice.getFinalizedCheckpoint();
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

  recomputeForkChoiceHead(caller: ForkchoiceCaller): ProtoBlock {
    this.metrics?.forkChoice.requests.inc();
    const timer = this.metrics?.forkChoice.findHead.startTimer({caller});

    try {
      return this.forkChoice.updateAndGetHead({mode: UpdateHeadOpt.GetCanonicalHead}).head;
    } catch (e) {
      this.metrics?.forkChoice.errors.inc({entrypoint: UpdateHeadOpt.GetCanonicalHead});
      throw e;
    } finally {
      timer?.();
    }
  }

  predictProposerHead(slot: Slot): ProtoBlock {
    this.metrics?.forkChoice.requests.inc();
    const timer = this.metrics?.forkChoice.findHead.startTimer({caller: FindHeadFnName.predictProposerHead});
    const secFromSlot = this.clock.secFromSlot(slot);

    try {
      return this.forkChoice.updateAndGetHead({mode: UpdateHeadOpt.GetPredictedProposerHead, secFromSlot, slot}).head;
    } catch (e) {
      this.metrics?.forkChoice.errors.inc({entrypoint: UpdateHeadOpt.GetPredictedProposerHead});
      throw e;
    } finally {
      timer?.();
    }
  }

  getProposerHead(slot: Slot): ProtoBlock {
    this.metrics?.forkChoice.requests.inc();
    const timer = this.metrics?.forkChoice.findHead.startTimer({caller: FindHeadFnName.getProposerHead});
    const secFromSlot = this.clock.secFromSlot(slot);

    try {
      const {head, isHeadTimely, notReorgedReason} = this.forkChoice.updateAndGetHead({
        mode: UpdateHeadOpt.GetProposerHead,
        secFromSlot,
        slot,
      });

      if (isHeadTimely && notReorgedReason !== undefined) {
        this.metrics?.forkChoice.notReorgedReason.inc({reason: notReorgedReason});
      }
      return head;
    } catch (e) {
      this.metrics?.forkChoice.errors.inc({entrypoint: UpdateHeadOpt.GetProposerHead});
      throw e;
    } finally {
      timer?.();
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
    preState: CachedBeaconStateAllForks,
    postState: CachedBeaconStateAllForks,
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
        `preState_slot_${preState.slot}_${preState.type.typeName}`,
        preState.serialize(),
        preState.hashTreeRoot(),
        `${logStr}_pre_state`
      ),
      this.persistSszObject(
        `postState_slot_${postState.slot}_${postState.type.typeName}`,
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

  persistInvalidSszView(view: TreeView<CompositeTypeAny>, suffix?: string): void {
    if (this.opts.persistInvalidSszObjects) {
      void this.persistSszObject(view.type.typeName, view.serialize(), view.hashTreeRoot(), suffix);
    }
  }

  /**
   * Regenerate state for attestation verification, this does not happen with default chain option of maxSkipSlots = 32 .
   * However, need to handle just in case. Lodestar doesn't support multiple regen state requests for attestation verification
   * at the same time, bounded inside "ShufflingCache.insertPromise()" function.
   * Leave this function in chain instead of attestatation verification code to make sure we're aware of its performance impact.
   */
  async regenStateForAttestationVerification(
    attEpoch: Epoch,
    shufflingDependentRoot: RootHex,
    attHeadBlock: ProtoBlock,
    regenCaller: RegenCaller
  ): Promise<EpochShuffling> {
    // this is to prevent multiple calls to get shuffling for the same epoch and dependent root
    // any subsequent calls of the same epoch and dependent root will wait for this promise to resolve
    this.shufflingCache.insertPromise(attEpoch, shufflingDependentRoot);
    const blockEpoch = computeEpochAtSlot(attHeadBlock.slot);

    let state: CachedBeaconStateAllForks;
    if (blockEpoch < attEpoch - 1) {
      // thanks to one epoch look ahead, we don't need to dial up to attEpoch
      const targetSlot = computeStartSlotAtEpoch(attEpoch - 1);
      this.metrics?.gossipAttestation.useHeadBlockStateDialedToTargetEpoch.inc({caller: regenCaller});
      state = await this.regen.getBlockSlotState(
        attHeadBlock.blockRoot,
        targetSlot,
        {dontTransferCache: true},
        regenCaller
      );
    } else if (blockEpoch > attEpoch) {
      // should not happen, handled inside attestation verification code
      throw Error(`Block epoch ${blockEpoch} is after attestation epoch ${attEpoch}`);
    } else {
      // should use either current or next shuffling of head state
      // it's not likely to hit this since these shufflings are cached already
      // so handle just in case
      this.metrics?.gossipAttestation.useHeadBlockState.inc({caller: regenCaller});
      state = await this.regen.getState(attHeadBlock.stateRoot, regenCaller);
    }

    // should always be the current epoch of the active context so no need to await a result from the ShufflingCache
    return state.epochCtx.getShufflingAtEpoch(attEpoch);
  }

  /**
   * `ForkChoice.onBlock` must never throw for a block that is valid with respect to the network
   * `justifiedBalancesGetter()` must never throw and it should always return a state.
   * @param blockState state that declares justified checkpoint `checkpoint`
   */
  private justifiedBalancesGetter(
    checkpoint: CheckpointWithHex,
    blockState: CachedBeaconStateAllForks
  ): EffectiveBalanceIncrements {
    this.metrics?.balancesCache.requests.inc();

    const effectiveBalances = this.checkpointBalancesCache.get(checkpoint);
    if (effectiveBalances) {
      return effectiveBalances;
    }
    // not expected, need metrics
    this.metrics?.balancesCache.misses.inc();
    this.logger.debug("checkpointBalances cache miss", {
      epoch: checkpoint.epoch,
      root: checkpoint.rootHex,
    });

    const {state, stateId, shouldWarn} = this.closestJustifiedBalancesStateToCheckpoint(checkpoint, blockState);
    this.metrics?.balancesCache.closestStateResult.inc({stateId});
    if (shouldWarn) {
      this.logger.warn("currentJustifiedCheckpoint state not avail, using closest state", {
        checkpointEpoch: checkpoint.epoch,
        checkpointRoot: checkpoint.rootHex,
        stateId,
        stateSlot: state.slot,
        stateRoot: toRootHex(state.hashTreeRoot()),
      });
    }

    return getEffectiveBalanceIncrementsZeroInactive(state);
  }

  /**
   * - Assumptions + invariant this function is based on:
   * - Our cache can only persist X states at once to prevent OOM
   * - Some old states (including to-be justified checkpoint) may / must be dropped from the cache
   * - Thus, there is no guarantee that the state for a justified checkpoint will be available in the cache
   * @param blockState state that declares justified checkpoint `checkpoint`
   */
  private closestJustifiedBalancesStateToCheckpoint(
    checkpoint: CheckpointWithHex,
    blockState: CachedBeaconStateAllForks
  ): {state: CachedBeaconStateAllForks; stateId: string; shouldWarn: boolean} {
    const state = this.regen.getCheckpointStateSync(checkpoint);
    if (state) {
      return {state, stateId: "checkpoint_state", shouldWarn: false};
    }

    // Check if blockState is in the same epoch, not need to iterate the fork-choice then
    if (computeEpochAtSlot(blockState.slot) === checkpoint.epoch) {
      return {state: blockState, stateId: "block_state_same_epoch", shouldWarn: true};
    }

    // Find a state in the same branch of checkpoint at same epoch. Balances should exactly the same
    for (const descendantBlock of this.forkChoice.forwardIterateDescendants(checkpoint.rootHex)) {
      if (computeEpochAtSlot(descendantBlock.slot) === checkpoint.epoch) {
        const descendantBlockState = this.regen.getStateSync(descendantBlock.stateRoot);
        if (descendantBlockState) {
          return {state: descendantBlockState, stateId: "descendant_state_same_epoch", shouldWarn: true};
        }
      }
    }

    // Check if blockState is in the next epoch, not need to iterate the fork-choice then
    if (computeEpochAtSlot(blockState.slot) === checkpoint.epoch + 1) {
      return {state: blockState, stateId: "block_state_next_epoch", shouldWarn: true};
    }

    // Find a state in the same branch of checkpoint at a latter epoch. Balances are not the same, but should be close
    // Note: must call .forwardIterateDescendants() again since nodes are not sorted
    for (const descendantBlock of this.forkChoice.forwardIterateDescendants(checkpoint.rootHex)) {
      if (computeEpochAtSlot(descendantBlock.slot) > checkpoint.epoch) {
        const descendantBlockState = this.regen.getStateSync(descendantBlock.stateRoot);
        if (descendantBlockState) {
          return {state: blockState, stateId: "descendant_state_latter_epoch", shouldWarn: true};
        }
      }
    }

    // If there's no state available in the same branch of checkpoint use blockState regardless of its epoch
    return {state: blockState, stateId: "block_state_any_epoch", shouldWarn: true};
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
    // aggregatedAttestationPool tracks metrics on its own
    metrics.opPool.attestationPool.size.set(this.attestationPool.getAttestationCount());
    metrics.opPool.attesterSlashingPoolSize.set(this.opPool.attesterSlashingsSize);
    metrics.opPool.proposerSlashingPoolSize.set(this.opPool.proposerSlashingsSize);
    metrics.opPool.voluntaryExitPoolSize.set(this.opPool.voluntaryExitsSize);
    metrics.opPool.syncCommitteeMessagePoolSize.set(this.syncCommitteeMessagePool.size);
    // syncContributionAndProofPool tracks metrics on its own
    metrics.opPool.blsToExecutionChangePoolSize.set(this.opPool.blsToExecutionChangeSize);
    metrics.chain.blacklistedBlocks.set(this.blacklistedBlocks.size);

    const headState = this.getHeadState();
    const fork = this.config.getForkName(headState.slot);

    if (isForkPostElectra(fork)) {
      const headStateElectra = headState as BeaconStateElectra;
      metrics.pendingDeposits.set(headStateElectra.pendingDeposits.length);
      metrics.pendingPartialWithdrawals.set(headStateElectra.pendingPartialWithdrawals.length);
      metrics.pendingConsolidations.set(headStateElectra.pendingConsolidations.length);
    }
  }

  private onClockSlot(slot: Slot): void {
    this.logger.verbose("Clock slot", {slot});

    // CRITICAL UPDATE
    if (this.forkChoice.irrecoverableError) {
      this.processShutdownCallback(this.forkChoice.irrecoverableError);
    }

    this.forkChoice.updateTime(slot);
    this.metrics?.clockSlot.set(slot);

    this.attestationPool.prune(slot);
    this.aggregatedAttestationPool.prune(slot);
    this.syncCommitteeMessagePool.prune(slot);
    this.seenSyncCommitteeMessages.prune(slot);
    this.seenAttestationDatas.onSlot(slot);
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

    this.seenAttesters.prune(epoch);
    this.seenAggregators.prune(epoch);
    this.seenAggregatedAttestations.prune(epoch);
    this.seenBlockAttesters.prune(epoch);
    this.beaconProposerCache.prune(epoch);

    // Poll for merge block in the background to speed-up block production. Only if:
    // - after BELLATRIX_FORK_EPOCH
    // - Beacon node synced
    // - head state not isMergeTransitionComplete
    if (this.config.BELLATRIX_FORK_EPOCH - epoch < 1) {
      const head = this.forkChoice.getHead();
      if (epoch - computeEpochAtSlot(head.slot) < 5 && head.executionStatus === ExecutionStatus.PreMerge) {
        this.eth1.startPollingMergeBlock();
      }
    }
  }

  protected onNewHead(head: ProtoBlock): void {
    this.syncContributionAndProofPool.prune(head.slot);
    this.seenContributionAndProof.prune(head.slot);
  }

  private onForkChoiceJustified(this: BeaconChain, cp: CheckpointWithHex): void {
    this.logger.verbose("Fork choice justified", {epoch: cp.epoch, root: cp.rootHex});
  }

  private async onForkChoiceFinalized(this: BeaconChain, cp: CheckpointWithHex): Promise<void> {
    this.logger.verbose("Fork choice finalized", {epoch: cp.epoch, root: cp.rootHex});
    this.seenBlockProposers.prune(computeStartSlotAtEpoch(cp.epoch));

    // Update validator custody to account for effective balance changes
    await this.updateValidatorsCustodyRequirement(cp);

    // TODO: Improve using regen here
    const {blockRoot, stateRoot, slot} = this.forkChoice.getHead();
    const headState = this.regen.getStateSync(stateRoot);
    const headBlock = await this.db.block.get(fromHex(blockRoot));
    if (headBlock == null) {
      throw Error(`Head block ${slot} ${headBlock} is not available in database`);
    }

    if (headState) {
      this.opPool.pruneAll(headBlock, headState);
    }

    if (headState === null) {
      this.logger.verbose("Head state is null");
    }
  }

  async updateBeaconProposerData(epoch: Epoch, proposers: ProposerPreparationData[]): Promise<void> {
    const previousValidatorCount = this.beaconProposerCache.getValidatorIndices().length;

    for (const proposer of proposers) {
      this.beaconProposerCache.add(epoch, proposer);
    }

    const newValidatorCount = this.beaconProposerCache.getValidatorIndices().length;

    // Only update validator custody if we discovered new validators
    if (newValidatorCount > previousValidatorCount) {
      const finalizedCheckpoint = this.forkChoice.getFinalizedCheckpoint();
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
    const validatorIndices = this.beaconProposerCache.getValidatorIndices();

    // Update custody requirement based on finalized state
    let effectiveBalances: number[];
    const effectiveBalanceIncrements = this.checkpointBalancesCache.get(finalizedCheckpoint);
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
        effectiveBalances = validatorIndices.map((index) => stateOrBytes.validators.get(index).effectiveBalance ?? 0);
      }
    }

    const targetCustodyGroupCount = getValidatorsCustodyRequirement(this.config, effectiveBalances);
    // Only update if target is increased
    if (targetCustodyGroupCount > this.custodyConfig.targetCustodyGroupCount) {
      this.custodyConfig.updateTargetCustodyGroupCount(targetCustodyGroupCount);
      this.metrics?.peerDas.targetCustodyGroupCount.set(targetCustodyGroupCount);
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
      const slotsPresent = this.forkChoice.getSlotsPresent(clockSlot - faultInspectionWindow);
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

  async getBlockRewards(block: BeaconBlock | BlindedBeaconBlock): Promise<BlockRewards> {
    let preState = this.regen.getPreStateSync(block);

    if (preState === null) {
      throw Error(`Pre-state is unavailable given block's parent root ${toRootHex(block.parentRoot)}`);
    }

    preState = processSlots(preState, block.slot); // Dial preState's slot to block.slot

    const postState = this.regen.getStateSync(toRootHex(block.stateRoot)) ?? undefined;

    return computeBlockRewards(block, preState.clone(), postState?.clone());
  }

  async getAttestationsRewards(
    epoch: Epoch,
    validatorIds?: (ValidatorIndex | string)[]
  ): Promise<{rewards: AttestationsRewards; executionOptimistic: boolean; finalized: boolean}> {
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

    const rewards = await computeAttestationsRewards(epoch, cachedState, this.config, validatorIds);

    return {rewards, executionOptimistic, finalized};
  }

  async getSyncCommitteeRewards(
    block: BeaconBlock | BlindedBeaconBlock,
    validatorIds?: (ValidatorIndex | string)[]
  ): Promise<SyncCommitteeRewards> {
    let preState = this.regen.getPreStateSync(block);

    if (preState === null) {
      throw Error(`Pre-state is unavailable given block's parent root ${toRootHex(block.parentRoot)}`);
    }

    preState = processSlots(preState, block.slot); // Dial preState's slot to block.slot

    return computeSyncCommitteeRewards(this.index2pubkey, block, preState.clone(), validatorIds);
  }
}
