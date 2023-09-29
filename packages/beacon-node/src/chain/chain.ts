import path from "node:path";
import {CompositeTypeAny, fromHexString, TreeView, Type} from "@chainsafe/ssz";
import {
  BeaconStateAllForks,
  CachedBeaconStateAllForks,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  createCachedBeaconState,
  EffectiveBalanceIncrements,
  getEffectiveBalanceIncrementsZeroInactive,
  isCachedBeaconState,
  Index2PubkeyCache,
  PubkeyIndexMap,
} from "@lodestar/state-transition";
import {BeaconConfig} from "@lodestar/config";
import {
  allForks,
  UintNum64,
  Root,
  phase0,
  Slot,
  RootHex,
  Epoch,
  ValidatorIndex,
  deneb,
  Wei,
  bellatrix,
} from "@lodestar/types";
import {CheckpointWithHex, ExecutionStatus, IForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {ProcessShutdownCallback} from "@lodestar/validator";
import {Logger, isErrorAborted, pruneSetToMax, sleep, toHex} from "@lodestar/utils";
import {ForkSeq, SLOTS_PER_EPOCH, MAX_BLOBS_PER_BLOCK} from "@lodestar/params";

import {GENESIS_EPOCH, ZERO_HASH} from "../constants/index.js";
import {IBeaconDb} from "../db/index.js";
import {Metrics} from "../metrics/index.js";
import {IEth1ForBlockProduction} from "../eth1/index.js";
import {IExecutionEngine, IExecutionBuilder} from "../execution/index.js";
import {Clock, ClockEvent, IClock} from "../util/clock.js";
import {ensureDir, writeIfNotExist} from "../util/file.js";
import {isOptimisticBlock} from "../util/forkChoice.js";
import {CheckpointStateCache, StateContextCache} from "./stateCache/index.js";
import {BlockProcessor, ImportBlockOpts} from "./blocks/index.js";
import {ChainEventEmitter, ChainEvent} from "./emitter.js";
import {IBeaconChain, ProposerPreparationData, BlockHash, StateGetOpts} from "./interface.js";
import {IChainOptions} from "./options.js";
import {QueuedStateRegenerator, RegenCaller} from "./regen/index.js";
import {initializeForkChoice} from "./forkChoice/index.js";
import {computeAnchorCheckpoint} from "./initState.js";
import {IBlsVerifier, BlsSingleThreadVerifier, BlsMultiThreadWorkerPool} from "./bls/index.js";
import {
  SeenAttesters,
  SeenAggregators,
  SeenBlockProposers,
  SeenSyncCommitteeMessages,
  SeenContributionAndProof,
} from "./seenCache/index.js";
import {
  AggregatedAttestationPool,
  AttestationPool,
  SyncCommitteeMessagePool,
  SyncContributionAndProofPool,
  OpPool,
} from "./opPools/index.js";
import {LightClientServer} from "./lightClient/index.js";
import {Archiver} from "./archiver/index.js";
import {PrepareNextSlotScheduler} from "./prepareNextSlot.js";
import {ReprocessController} from "./reprocess.js";
import {SeenAggregatedAttestations} from "./seenCache/seenAggregateAndProof.js";
import {SeenBlockAttesters} from "./seenCache/seenBlockAttesters.js";
import {BeaconProposerCache} from "./beaconProposerCache.js";
import {CheckpointBalancesCache} from "./balancesCache.js";
import {AssembledBlockType, BlobsResultType, BlockType} from "./produceBlock/index.js";
import {BlockAttributes, produceBlockBody} from "./produceBlock/produceBlockBody.js";
import {computeNewStateRoot} from "./produceBlock/computeNewStateRoot.js";
import {BlockInput} from "./blocks/types.js";
import {SeenAttestationDatas} from "./seenCache/seenAttestationData.js";

/**
 * Arbitrary constants, blobs should be consumed immediately in the same slot they are produced.
 * A value of 1 would probably be sufficient. However it's sensible to allow some margin if the node overloads.
 */
const DEFAULT_MAX_CACHED_BLOB_SIDECARS = MAX_BLOBS_PER_BLOCK * 2;
const MAX_RETAINED_SLOTS_CACHED_BLOBS_SIDECAR = 8;
// we have seen two attempts in a single slot so we factor for four
const DEFAULT_MAX_CACHED_PRODUCED_ROOTS = 4;

export class BeaconChain implements IBeaconChain {
  readonly genesisTime: UintNum64;
  readonly genesisValidatorsRoot: Root;
  readonly eth1: IEth1ForBlockProduction;
  readonly executionEngine: IExecutionEngine;
  readonly executionBuilder?: IExecutionBuilder;
  // Expose config for convenience in modularized functions
  readonly config: BeaconConfig;
  readonly logger: Logger;
  readonly metrics: Metrics | null;

  readonly anchorStateLatestBlockSlot: Slot;

  readonly bls: IBlsVerifier;
  readonly forkChoice: IForkChoice;
  readonly clock: IClock;
  readonly emitter: ChainEventEmitter;
  readonly regen: QueuedStateRegenerator;
  readonly lightClientServer: LightClientServer;
  readonly reprocessController: ReprocessController;

  // Ops pool
  readonly attestationPool: AttestationPool;
  readonly aggregatedAttestationPool = new AggregatedAttestationPool();
  readonly syncCommitteeMessagePool: SyncCommitteeMessagePool;
  readonly syncContributionAndProofPool = new SyncContributionAndProofPool();
  readonly opPool = new OpPool();

  // Gossip seen cache
  readonly seenAttesters = new SeenAttesters();
  readonly seenAggregators = new SeenAggregators();
  readonly seenAggregatedAttestations: SeenAggregatedAttestations;
  readonly seenBlockProposers = new SeenBlockProposers();
  readonly seenSyncCommitteeMessages = new SeenSyncCommitteeMessages();
  readonly seenContributionAndProof: SeenContributionAndProof;
  readonly seenAttestationDatas: SeenAttestationDatas;
  // Seen cache for liveness checks
  readonly seenBlockAttesters = new SeenBlockAttesters();

  // Global state caches
  readonly pubkey2index: PubkeyIndexMap;
  readonly index2pubkey: Index2PubkeyCache;

  readonly beaconProposerCache: BeaconProposerCache;
  readonly checkpointBalancesCache: CheckpointBalancesCache;
  // TODO DENEB: Prune data structure every time period, for both old entries
  /** Map keyed by executionPayload.blockHash of the block for those blobs */
  readonly producedBlobSidecarsCache = new Map<BlockHash, {blobSidecars: deneb.BlobSidecars; slot: Slot}>();
  readonly producedBlindedBlobSidecarsCache = new Map<
    BlockHash,
    {blobSidecars: deneb.BlindedBlobSidecars; slot: Slot}
  >();

  readonly producedBlockRoot = new Set<RootHex>();
  readonly producedBlindedBlockRoot = new Set<RootHex>();

  readonly opts: IChainOptions;

  protected readonly blockProcessor: BlockProcessor;
  protected readonly db: IBeaconDb;
  private readonly archiver: Archiver;
  private abortController = new AbortController();
  private processShutdownCallback: ProcessShutdownCallback;

  constructor(
    opts: IChainOptions,
    {
      config,
      db,
      logger,
      processShutdownCallback,
      clock,
      metrics,
      anchorState,
      eth1,
      executionEngine,
      executionBuilder,
    }: {
      config: BeaconConfig;
      db: IBeaconDb;
      logger: Logger;
      processShutdownCallback: ProcessShutdownCallback;
      /** Used for testing to supply fake clock */
      clock?: IClock;
      metrics: Metrics | null;
      anchorState: BeaconStateAllForks;
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

    const preAggregateCutOffTime = (2 / 3) * this.config.SECONDS_PER_SLOT;
    this.attestationPool = new AttestationPool(clock, preAggregateCutOffTime, this.opts?.preaggregateSlotDistance);
    this.syncCommitteeMessagePool = new SyncCommitteeMessagePool(
      clock,
      preAggregateCutOffTime,
      this.opts?.preaggregateSlotDistance
    );

    this.seenAggregatedAttestations = new SeenAggregatedAttestations(metrics);
    this.seenContributionAndProof = new SeenContributionAndProof(metrics);
    this.seenAttestationDatas = new SeenAttestationDatas(metrics, this.opts?.attDataCacheSlotDistance);

    this.beaconProposerCache = new BeaconProposerCache(opts);
    this.checkpointBalancesCache = new CheckpointBalancesCache();

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

    // Persist single global instance of state caches
    this.pubkey2index = cachedState.epochCtx.pubkey2index;
    this.index2pubkey = cachedState.epochCtx.index2pubkey;

    const stateCache = new StateContextCache({metrics});
    const checkpointStateCache = new CheckpointStateCache({metrics});

    const {checkpoint} = computeAnchorCheckpoint(config, anchorState);
    stateCache.add(cachedState);
    stateCache.setHeadState(cachedState);
    checkpointStateCache.add(checkpoint, cachedState);

    const forkChoice = initializeForkChoice(
      config,
      emitter,
      clock.currentSlot,
      cachedState,
      opts,
      this.justifiedBalancesGetter.bind(this)
    );
    const regen = new QueuedStateRegenerator({
      config,
      forkChoice,
      stateCache,
      checkpointStateCache,
      db,
      metrics,
      logger,
      emitter,
      signal,
    });

    const lightClientServer = new LightClientServer(opts, {config, db, metrics, emitter, logger});

    this.reprocessController = new ReprocessController(this.metrics);

    this.blockProcessor = new BlockProcessor(this, metrics, opts, signal);

    this.forkChoice = forkChoice;
    this.clock = clock;
    this.regen = regen;
    this.bls = bls;
    this.emitter = emitter;
    this.lightClientServer = lightClientServer;

    this.archiver = new Archiver(db, this, logger, signal, opts);
    // always run PrepareNextSlotScheduler except for fork_choice spec tests
    if (!opts?.disablePrepareNextSlot) {
      new PrepareNextSlotScheduler(this, this.config, metrics, this.logger, signal);
    }

    if (metrics) {
      metrics.opPool.aggregatedAttestationPoolSize.addCollect(() => this.onScrapeMetrics(metrics));
    }

    // Event handlers. emitter is created internally and dropped on close(). Not need to .removeListener()
    clock.addListener(ClockEvent.slot, this.onClockSlot.bind(this));
    clock.addListener(ClockEvent.epoch, this.onClockEpoch.bind(this));
    emitter.addListener(ChainEvent.forkChoiceFinalized, this.onForkChoiceFinalized.bind(this));
    emitter.addListener(ChainEvent.forkChoiceJustified, this.onForkChoiceJustified.bind(this));
  }

  async close(): Promise<void> {
    this.abortController.abort();
    await this.bls.close();
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
    await this.opPool.fromPersisted(this.db);
  }

  /** Persist in-memory data to the DB. Call at least once before stopping the process */
  async persistToDisk(): Promise<void> {
    await this.archiver.persistToDisk();
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
  ): Promise<{state: BeaconStateAllForks; executionOptimistic: boolean} | null> {
    const finalizedBlock = this.forkChoice.getFinalizedBlock();

    if (slot >= finalizedBlock.slot) {
      // request for non-finalized state

      if (opts?.allowRegen) {
        // Find closest canonical block to slot, then trigger regen
        const block = this.forkChoice.getCanonicalBlockClosestLteSlot(slot) ?? finalizedBlock;
        const state = await this.regen.getBlockSlotState(
          block.blockRoot,
          slot,
          {dontTransferCache: true},
          RegenCaller.restApi
        );
        return {state, executionOptimistic: isOptimisticBlock(block)};
      } else {
        // Just check if state is already in the cache. If it's not dialed to the correct slot,
        // do not bother in advancing the state. restApiCanTriggerRegen == false means do no work
        const block = this.forkChoice.getCanonicalBlockAtSlot(slot);
        if (!block) {
          return null;
        }

        const state = this.regen.getStateSync(block.stateRoot);
        return state && {state, executionOptimistic: isOptimisticBlock(block)};
      }
    } else {
      // request for finalized state

      // do not attempt regen, just check if state is already in DB
      const state = await this.db.stateArchive.get(slot);
      return state && {state, executionOptimistic: false};
    }
  }

  async getStateByStateRoot(
    stateRoot: RootHex,
    opts?: StateGetOpts
  ): Promise<{state: BeaconStateAllForks; executionOptimistic: boolean} | null> {
    if (opts?.allowRegen) {
      const state = await this.regen.getState(stateRoot, RegenCaller.restApi);
      const block = this.forkChoice.getBlock(state.latestBlockHeader.hashTreeRoot());
      return {state, executionOptimistic: block != null && isOptimisticBlock(block)};
    }

    // TODO: This can only fulfill requests for a very narrow set of roots.
    // - very recent states that happen to be in the cache
    // - 1 every 100s of states that are persisted in the archive state

    // TODO: This is very inneficient for debug requests of serialized content, since it deserializes to serialize again
    const cachedStateCtx = this.regen.getStateSync(stateRoot);
    if (cachedStateCtx) {
      const block = this.forkChoice.getBlock(cachedStateCtx.latestBlockHeader.hashTreeRoot());
      return {state: cachedStateCtx, executionOptimistic: block != null && isOptimisticBlock(block)};
    }

    const data = await this.db.stateArchive.getByRoot(fromHexString(stateRoot));
    return data && {state: data, executionOptimistic: false};
  }

  async getCanonicalBlockAtSlot(
    slot: Slot
  ): Promise<{block: allForks.SignedBeaconBlock; executionOptimistic: boolean} | null> {
    const finalizedBlock = this.forkChoice.getFinalizedBlock();
    if (slot > finalizedBlock.slot) {
      // Unfinalized slot, attempt to find in fork-choice
      const block = this.forkChoice.getCanonicalBlockAtSlot(slot);
      if (block) {
        const data = await this.db.block.get(fromHexString(block.blockRoot));
        if (data) {
          return {block: data, executionOptimistic: isOptimisticBlock(block)};
        }
      }
      // A non-finalized slot expected to be found in the hot db, could be archived during
      // this function runtime, so if not found in the hot db, fallback to the cold db
      // TODO: Add a lock to the archiver to have determinstic behaviour on where are blocks
    }

    const data = await this.db.blockArchive.get(slot);
    return data && {block: data, executionOptimistic: false};
  }

  async getBlockByRoot(
    root: string
  ): Promise<{block: allForks.SignedBeaconBlock; executionOptimistic: boolean} | null> {
    const block = this.forkChoice.getBlockHex(root);
    if (block) {
      const data = await this.db.block.get(fromHexString(root));
      if (data) {
        return {block: data, executionOptimistic: isOptimisticBlock(block)};
      }
      // If block is not found in hot db, try cold db since there could be an archive cycle happening
      // TODO: Add a lock to the archiver to have determinstic behaviour on where are blocks
    }

    const data = await this.db.blockArchive.getByRoot(fromHexString(root));
    return data && {block: data, executionOptimistic: false};
  }

  produceBlock(blockAttributes: BlockAttributes): Promise<{block: allForks.BeaconBlock; blockValue: Wei}> {
    return this.produceBlockWrapper<BlockType.Full>(BlockType.Full, blockAttributes);
  }

  produceBlindedBlock(
    blockAttributes: BlockAttributes
  ): Promise<{block: allForks.BlindedBeaconBlock; blockValue: Wei}> {
    return this.produceBlockWrapper<BlockType.Blinded>(BlockType.Blinded, blockAttributes);
  }

  async produceBlockWrapper<T extends BlockType>(
    blockType: T,
    {randaoReveal, graffiti, slot, feeRecipient}: BlockAttributes
  ): Promise<{block: AssembledBlockType<T>; blockValue: Wei}> {
    const head = this.forkChoice.getHead();
    const state = await this.regen.getBlockSlotState(
      head.blockRoot,
      slot,
      {dontTransferCache: true},
      RegenCaller.produceBlock
    );
    const parentBlockRoot = fromHexString(head.blockRoot);
    const proposerIndex = state.epochCtx.getBeaconProposer(slot);
    const proposerPubKey = state.epochCtx.index2pubkey[proposerIndex].toBytes();

    const {body, blobs, blockValue} = await produceBlockBody.call(this, blockType, state, {
      randaoReveal,
      graffiti,
      slot,
      feeRecipient,
      parentSlot: slot - 1,
      parentBlockRoot,
      proposerIndex,
      proposerPubKey,
    });

    const block = {
      slot,
      proposerIndex,
      parentRoot: parentBlockRoot,
      stateRoot: ZERO_HASH,
      body,
    } as AssembledBlockType<T>;

    block.stateRoot = computeNewStateRoot(this.metrics, state, block);

    // track the produced block for consensus broadcast validations
    const blockRoot = this.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block);
    const blockRootHex = toHex(blockRoot);
    const producedRootTracker = blockType === BlockType.Full ? this.producedBlockRoot : this.producedBlindedBlockRoot;
    producedRootTracker.add(blockRootHex);
    pruneSetToMax(producedRootTracker, this.opts.maxCachedProducedRoots ?? DEFAULT_MAX_CACHED_PRODUCED_ROOTS);

    // Cache for latter broadcasting
    //
    // blinded blobs will be fetched and added to this cache later before finally
    // publishing the blinded block's full version
    if (blobs.type === BlobsResultType.produced) {
      // body is of full type here
      const blockHash = toHex((block as bellatrix.BeaconBlock).body.executionPayload.blockHash);
      const blobSidecars = blobs.blobSidecars.map((blobSidecar) => ({
        ...blobSidecar,
        blockRoot,
        slot,
        blockParentRoot: parentBlockRoot,
        proposerIndex,
      }));

      this.producedBlobSidecarsCache.set(blockHash, {blobSidecars, slot});
      pruneSetToMax(
        this.producedBlobSidecarsCache,
        this.opts.maxCachedBlobSidecars ?? DEFAULT_MAX_CACHED_BLOB_SIDECARS
      );
    }

    return {block, blockValue};
  }

  /**
   * https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/validator.md#sidecar
   * def get_blobs_sidecar(block: BeaconBlock, blobs: Sequence[Blob]) -> BlobSidecars:
   *   return BlobSidecars(
   *       beacon_block_root=hash_tree_root(block),
   *       beacon_block_slot=block.slot,
   *       blobs=blobs,
   *       kzg_aggregated_proof=compute_proof_from_blobs(blobs),
   *   )
   */
  getBlobSidecars(beaconBlock: deneb.BeaconBlock): deneb.BlobSidecars {
    const blockHash = toHex(beaconBlock.body.executionPayload.blockHash);
    const {blobSidecars} = this.producedBlobSidecarsCache.get(blockHash) ?? {};
    if (!blobSidecars) {
      throw Error(`No blobSidecars for executionPayload.blockHash ${blockHash}`);
    }

    return blobSidecars;
  }

  async processBlock(block: BlockInput, opts?: ImportBlockOpts): Promise<void> {
    return this.blockProcessor.processBlocksJob([block], opts);
  }

  async processChainSegment(blocks: BlockInput[], opts?: ImportBlockOpts): Promise<void> {
    return this.blockProcessor.processBlocksJob(blocks, opts);
  }

  getStatus(): phase0.Status {
    const head = this.forkChoice.getHead();
    const finalizedCheckpoint = this.forkChoice.getFinalizedCheckpoint();
    return {
      // fork_digest: The node's ForkDigest (compute_fork_digest(current_fork_version, genesis_validators_root)) where
      // - current_fork_version is the fork version at the node's current epoch defined by the wall-clock time (not necessarily the epoch to which the node is sync)
      // - genesis_validators_root is the static Root found in state.genesis_validators_root
      forkDigest: this.config.forkName2ForkDigest(this.config.getForkName(this.clock.currentSlot)),
      // finalized_root: state.finalized_checkpoint.root for the state corresponding to the head block (Note this defaults to Root(b'\x00' * 32) for the genesis finalized checkpoint).
      finalizedRoot: finalizedCheckpoint.epoch === GENESIS_EPOCH ? ZERO_HASH : finalizedCheckpoint.root,
      finalizedEpoch: finalizedCheckpoint.epoch,
      // TODO: PERFORMANCE: Memoize to prevent re-computing every time
      headRoot: fromHexString(head.blockRoot),
      headSlot: head.slot,
    };
  }

  recomputeForkChoiceHead(): ProtoBlock {
    this.metrics?.forkChoice.requests.inc();
    const timer = this.metrics?.forkChoice.findHead.startTimer();

    try {
      return this.forkChoice.updateHead();
    } catch (e) {
      this.metrics?.forkChoice.errors.inc();
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

  persistInvalidSszValue<T>(type: Type<T>, sszObject: T, suffix?: string): void {
    if (this.opts.persistInvalidSszObjects) {
      void this.persistInvalidSszObject(type.typeName, type.serialize(sszObject), type.hashTreeRoot(sszObject), suffix);
    }
  }

  persistInvalidSszBytes(typeName: string, sszBytes: Uint8Array, suffix?: string): void {
    if (this.opts.persistInvalidSszObjects) {
      void this.persistInvalidSszObject(typeName, sszBytes, sszBytes, suffix);
    }
  }

  persistInvalidSszView(view: TreeView<CompositeTypeAny>, suffix?: string): void {
    if (this.opts.persistInvalidSszObjects) {
      void this.persistInvalidSszObject(view.type.typeName, view.serialize(), view.hashTreeRoot(), suffix);
    }
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
    } else {
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
          stateRoot: toHex(state.hashTreeRoot()),
        });
      }

      return getEffectiveBalanceIncrementsZeroInactive(state);
    }
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

  private async persistInvalidSszObject(
    typeName: string,
    bytes: Uint8Array,
    root: Uint8Array,
    suffix?: string
  ): Promise<void> {
    if (!this.opts.persistInvalidSszObjects) {
      return;
    }

    const now = new Date();
    // yyyy-MM-dd
    const dateStr = now.toISOString().split("T")[0];

    // by default store to lodestar_archive of current dir
    const dirpath = path.join(this.opts.persistInvalidSszObjectsDir ?? "invalid_ssz_objects", dateStr);
    const filepath = path.join(dirpath, `${typeName}_${toHex(root)}.ssz`);

    await ensureDir(dirpath);

    // as of Feb 17 2022 there are a lot of duplicate files stored with different date suffixes
    // remove date suffixes in file name, and check duplicate to avoid redundant persistence
    await writeIfNotExist(filepath, bytes);

    this.logger.debug("Persisted invalid ssz object", {id: suffix, filepath});
  }

  private onScrapeMetrics(metrics: Metrics): void {
    const {attestationCount, attestationDataCount} = this.aggregatedAttestationPool.getAttestationCount();
    metrics.opPool.aggregatedAttestationPoolSize.set(attestationCount);
    metrics.opPool.aggregatedAttestationPoolUniqueData.set(attestationDataCount);
    metrics.opPool.attestationPoolSize.set(this.attestationPool.getAttestationCount());
    metrics.opPool.attesterSlashingPoolSize.set(this.opPool.attesterSlashingsSize);
    metrics.opPool.proposerSlashingPoolSize.set(this.opPool.proposerSlashingsSize);
    metrics.opPool.voluntaryExitPoolSize.set(this.opPool.voluntaryExitsSize);
    metrics.opPool.syncCommitteeMessagePoolSize.set(this.syncCommitteeMessagePool.size);
    metrics.opPool.syncContributionAndProofPoolSize.set(this.syncContributionAndProofPool.size);
    metrics.opPool.blsToExecutionChangePoolSize.set(this.opPool.blsToExecutionChangeSize);

    const forkChoiceMetrics = this.forkChoice.getMetrics();
    metrics.forkChoice.votes.set(forkChoiceMetrics.votes);
    metrics.forkChoice.queuedAttestations.set(forkChoiceMetrics.queuedAttestations);
    metrics.forkChoice.validatedAttestationDatas.set(forkChoiceMetrics.validatedAttestationDatas);
    metrics.forkChoice.balancesLength.set(forkChoiceMetrics.balancesLength);
    metrics.forkChoice.nodes.set(forkChoiceMetrics.nodes);
    metrics.forkChoice.indices.set(forkChoiceMetrics.indices);
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

    // Prune old blobSidecars for block production, those are only useful on their slot
    if (this.config.getForkSeq(slot) >= ForkSeq.deneb) {
      if (this.producedBlobSidecarsCache.size > 0) {
        for (const [key, {slot: blobSlot}] of this.producedBlobSidecarsCache) {
          if (slot > blobSlot + MAX_RETAINED_SLOTS_CACHED_BLOBS_SIDECAR) {
            this.producedBlobSidecarsCache.delete(key);
          }
        }
      }

      if (this.producedBlindedBlobSidecarsCache.size > 0) {
        for (const [key, {slot: blobSlot}] of this.producedBlindedBlobSidecarsCache) {
          if (slot > blobSlot + MAX_RETAINED_SLOTS_CACHED_BLOBS_SIDECAR) {
            this.producedBlindedBlobSidecarsCache.delete(key);
          }
        }
      }
    }

    const metrics = this.metrics;
    if (metrics && (slot + 1) % SLOTS_PER_EPOCH === 0) {
      // On the last slot of the epoch
      sleep((1000 * this.config.SECONDS_PER_SLOT) / 2)
        .then(() => metrics.onceEveryEndOfEpoch(this.getHeadState()))
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

  private onForkChoiceFinalized(this: BeaconChain, cp: CheckpointWithHex): void {
    this.logger.verbose("Fork choice finalized", {epoch: cp.epoch, root: cp.rootHex});
    this.seenBlockProposers.prune(computeStartSlotAtEpoch(cp.epoch));

    // TODO: Improve using regen here
    const headState = this.regen.getStateSync(this.forkChoice.getHead().stateRoot);
    const finalizedState = this.regen.getCheckpointStateSync(cp);
    if (headState) {
      this.opPool.pruneAll(headState, finalizedState);
    }
  }

  async updateBeaconProposerData(epoch: Epoch, proposers: ProposerPreparationData[]): Promise<void> {
    proposers.forEach((proposer) => {
      this.beaconProposerCache.add(epoch, proposer);
    });
  }

  updateBuilderStatus(clockSlot: Slot): void {
    const executionBuilder = this.executionBuilder;
    if (executionBuilder) {
      const {faultInspectionWindow, allowedFaults} = executionBuilder;
      const slotsPresent = this.forkChoice.getSlotsPresent(clockSlot - faultInspectionWindow);
      const previousStatus = executionBuilder.status;
      const shouldEnable = slotsPresent >= faultInspectionWindow - allowedFaults;

      executionBuilder.updateStatus(shouldEnable);
      // The status changed we should log
      const status = executionBuilder.status;
      const builderLog = {
        status,
        slotsPresent,
        faultInspectionWindow,
        allowedFaults,
      };
      if (status !== previousStatus) {
        this.logger.info("Execution builder status updated", builderLog);
      } else {
        this.logger.verbose("Execution builder status", builderLog);
      }
    }
  }
}
