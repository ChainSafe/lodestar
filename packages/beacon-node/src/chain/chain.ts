import path from "node:path";
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
import {allForks, UintNum64, Root, phase0, Slot, RootHex, Epoch, ValidatorIndex, deneb, Wei} from "@lodestar/types";
import {CheckpointWithHex, ExecutionStatus, IForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {ProcessShutdownCallback} from "@lodestar/validator";
import {Logger, pruneSetToMax, toHex} from "@lodestar/utils";
import {CompositeTypeAny, fromHexString, TreeView, Type} from "@chainsafe/ssz";
import {ForkSeq} from "@lodestar/params";

import {GENESIS_EPOCH, ZERO_HASH} from "../constants/index.js";
import {IBeaconDb} from "../db/index.js";
import {Metrics} from "../metrics/index.js";
import {bytesToData, numToQuantity} from "../eth1/provider/utils.js";
import {wrapError} from "../util/wrapError.js";
import {ckzg} from "../util/kzg.js";
import {IEth1ForBlockProduction} from "../eth1/index.js";
import {IExecutionEngine, IExecutionBuilder, TransitionConfigurationV1} from "../execution/index.js";
import {ensureDir, writeIfNotExist} from "../util/file.js";
import {CheckpointStateCache, StateContextCache} from "./stateCache/index.js";
import {BlockProcessor, ImportBlockOpts} from "./blocks/index.js";
import {BeaconClock, LocalClock} from "./clock/index.js";
import {ChainEventEmitter, ChainEvent} from "./emitter.js";
import {IBeaconChain, ProposerPreparationData} from "./interface.js";
import {IChainOptions} from "./options.js";
import {IStateRegenerator, QueuedStateRegenerator, RegenCaller} from "./regen/index.js";
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

/**
 * Arbitrary constants, blobs should be consumed immediately in the same slot they are produced.
 * A value of 1 would probably be sufficient. However it's sensible to allow some margin if the node overloads.
 */
const DEFAULT_MAX_CACHED_BLOBS_SIDECAR = 8;
const MAX_RETAINED_SLOTS_CACHED_BLOBS_SIDECAR = 8;

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
  readonly clock: BeaconClock;
  readonly emitter: ChainEventEmitter;
  readonly stateCache: StateContextCache;
  readonly checkpointStateCache: CheckpointStateCache;
  readonly regen: IStateRegenerator;
  readonly lightClientServer: LightClientServer;
  readonly reprocessController: ReprocessController;

  // Ops pool
  readonly attestationPool = new AttestationPool();
  readonly aggregatedAttestationPool = new AggregatedAttestationPool();
  readonly syncCommitteeMessagePool = new SyncCommitteeMessagePool();
  readonly syncContributionAndProofPool = new SyncContributionAndProofPool();
  readonly opPool = new OpPool();

  // Gossip seen cache
  readonly seenAttesters = new SeenAttesters();
  readonly seenAggregators = new SeenAggregators();
  readonly seenAggregatedAttestations: SeenAggregatedAttestations;
  readonly seenBlockProposers = new SeenBlockProposers();
  readonly seenSyncCommitteeMessages = new SeenSyncCommitteeMessages();
  readonly seenContributionAndProof: SeenContributionAndProof;
  // Seen cache for liveness checks
  readonly seenBlockAttesters = new SeenBlockAttesters();

  // Global state caches
  readonly pubkey2index: PubkeyIndexMap;
  readonly index2pubkey: Index2PubkeyCache;

  readonly beaconProposerCache: BeaconProposerCache;
  readonly checkpointBalancesCache: CheckpointBalancesCache;
  // TODO DENEB: Prune data structure every time period, for both old entries
  /** Map keyed by executionPayload.blockHash of the block for those blobs */
  readonly producedBlobsSidecarCache = new Map<RootHex, deneb.BlobsSidecar>();
  readonly opts: IChainOptions;

  protected readonly blockProcessor: BlockProcessor;
  protected readonly db: IBeaconDb;
  private readonly archiver: Archiver;
  private abortController = new AbortController();
  private successfulExchangeTransition = false;
  private readonly exchangeTransitionConfigurationEverySlots: number;

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
      clock?: BeaconClock;
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
    // From https://github.com/ethereum/execution-apis/blob/main/src/engine/specification.md#specification-3
    // > Consensus Layer client software SHOULD poll this endpoint every 60 seconds.
    // Align to a multiple of SECONDS_PER_SLOT for nicer logs
    this.exchangeTransitionConfigurationEverySlots = Math.floor(60 / this.config.SECONDS_PER_SLOT);

    const signal = this.abortController.signal;
    const emitter = new ChainEventEmitter();
    // by default, verify signatures on both main threads and worker threads
    const bls = opts.blsVerifyAllMainThread
      ? new BlsSingleThreadVerifier({metrics})
      : new BlsMultiThreadWorkerPool(opts, {logger, metrics});

    if (!clock) clock = new LocalClock({config, emitter, genesisTime: this.genesisTime, signal});

    this.seenAggregatedAttestations = new SeenAggregatedAttestations(metrics);
    this.seenContributionAndProof = new SeenContributionAndProof(metrics);

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
    this.checkpointStateCache = checkpointStateCache;
    this.stateCache = stateCache;
    this.emitter = emitter;
    this.lightClientServer = lightClientServer;

    this.archiver = new Archiver(db, this, logger, signal, opts);
    // always run PrepareNextSlotScheduler except for fork_choice spec tests
    if (!opts?.disablePrepareNextSlot) {
      new PrepareNextSlotScheduler(this, this.config, metrics, this.logger, signal);
    }

    metrics?.opPool.aggregatedAttestationPoolSize.addCollect(() => this.onScrapeMetrics());

    // Event handlers. emitter is created internally and dropped on close(). Not need to .removeListener()
    emitter.addListener(ChainEvent.clockSlot, this.onClockSlot.bind(this));
    emitter.addListener(ChainEvent.clockEpoch, this.onClockEpoch.bind(this));
    emitter.addListener(ChainEvent.forkChoiceFinalized, this.onForkChoiceFinalized.bind(this));
    emitter.addListener(ChainEvent.forkChoiceJustified, this.onForkChoiceJustified.bind(this));
  }

  async close(): Promise<void> {
    this.abortController.abort();
    this.stateCache.clear();
    this.checkpointStateCache.clear();
    await this.bls.close();
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
    const headState =
      this.checkpointStateCache.getLatest(head.blockRoot, Infinity) || this.stateCache.get(head.stateRoot);
    if (!headState) {
      throw Error(`headState does not exist for head root=${head.blockRoot} slot=${head.slot}`);
    }
    return headState;
  }

  async getHeadStateAtCurrentEpoch(): Promise<CachedBeaconStateAllForks> {
    const currentEpochStartSlot = computeStartSlotAtEpoch(this.clock.currentEpoch);
    const head = this.forkChoice.getHead();
    const bestSlot = currentEpochStartSlot > head.slot ? currentEpochStartSlot : head.slot;
    return this.regen.getBlockSlotState(head.blockRoot, bestSlot, {dontTransferCache: true}, RegenCaller.getDuties);
  }

  async getCanonicalBlockAtSlot(slot: Slot): Promise<allForks.SignedBeaconBlock | null> {
    const finalizedBlock = this.forkChoice.getFinalizedBlock();
    if (finalizedBlock.slot > slot) {
      return this.db.blockArchive.get(slot);
    }
    const block = this.forkChoice.getCanonicalBlockAtSlot(slot);
    if (!block) {
      return null;
    }
    return this.db.block.get(fromHexString(block.blockRoot));
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
    {randaoReveal, graffiti, slot}: BlockAttributes
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

    // Cache for latter broadcasting
    //
    // blinded blobs will be fetched and added to this cache later before finally
    // publishing the blinded block's full version
    if (blobs.type === BlobsResultType.produced) {
      // TODO DENEB: Prune data structure for max entries
      this.producedBlobsSidecarCache.set(blobs.blockHash, {
        // TODO DENEB: Optimize, hashing the full block is not free.
        beaconBlockRoot: this.config.getForkTypes(block.slot).BeaconBlock.hashTreeRoot(block),
        beaconBlockSlot: block.slot,
        blobs: blobs.blobs,
        kzgAggregatedProof: ckzg.computeAggregateKzgProof(blobs.blobs),
      });
      pruneSetToMax(
        this.producedBlobsSidecarCache,
        this.opts.maxCachedBlobsSidecar ?? DEFAULT_MAX_CACHED_BLOBS_SIDECAR
      );
    }

    return {block, blockValue};
  }

  /**
   * https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/validator.md#sidecar
   * def get_blobs_sidecar(block: BeaconBlock, blobs: Sequence[Blob]) -> BlobsSidecar:
   *   return BlobsSidecar(
   *       beacon_block_root=hash_tree_root(block),
   *       beacon_block_slot=block.slot,
   *       blobs=blobs,
   *       kzg_aggregated_proof=compute_proof_from_blobs(blobs),
   *   )
   */
  getBlobsSidecar(beaconBlock: deneb.BeaconBlock): deneb.BlobsSidecar {
    const blockHash = toHex(beaconBlock.body.executionPayload.blockHash);
    const blobsSidecar = this.producedBlobsSidecarCache.get(blockHash);
    if (!blobsSidecar) {
      throw Error(`No blobsSidecar for executionPayload.blockHash ${blockHash}`);
    }

    return blobsSidecar;
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
    const state = this.checkpointStateCache.get(checkpoint);
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
        const descendantBlockState = this.stateCache.get(descendantBlock.stateRoot);
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
        const descendantBlockState = this.stateCache.get(descendantBlock.stateRoot);
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

  private onScrapeMetrics(): void {
    const {attestationCount, attestationDataCount} = this.aggregatedAttestationPool.getAttestationCount();
    this.metrics?.opPool.aggregatedAttestationPoolSize.set(attestationCount);
    this.metrics?.opPool.aggregatedAttestationPoolUniqueData.set(attestationDataCount);
    this.metrics?.opPool.attestationPoolSize.set(this.attestationPool.getAttestationCount());
    this.metrics?.opPool.attesterSlashingPoolSize.set(this.opPool.attesterSlashingsSize);
    this.metrics?.opPool.proposerSlashingPoolSize.set(this.opPool.proposerSlashingsSize);
    this.metrics?.opPool.voluntaryExitPoolSize.set(this.opPool.voluntaryExitsSize);
    this.metrics?.opPool.syncCommitteeMessagePoolSize.set(this.syncCommitteeMessagePool.size);
    this.metrics?.opPool.syncContributionAndProofPoolSize.set(this.syncContributionAndProofPool.size);
    this.metrics?.opPool.blsToExecutionChangePoolSize.set(this.opPool.blsToExecutionChangeSize);
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
    this.reprocessController.onSlot(slot);

    if (isFinite(this.config.BELLATRIX_FORK_EPOCH) && slot % this.exchangeTransitionConfigurationEverySlots === 0) {
      this.exchangeTransitionConfiguration().catch((e) => {
        // Should never throw
        this.logger.error("Error on exchangeTransitionConfiguration", {}, e as Error);
      });
    }

    // Prune old blobsSidecar for block production, those are only useful on their slot
    if (this.config.getForkSeq(slot) >= ForkSeq.deneb && this.producedBlobsSidecarCache.size > 0) {
      for (const [key, blobsSidecar] of this.producedBlobsSidecarCache) {
        if (slot > blobsSidecar.beaconBlockSlot + MAX_RETAINED_SLOTS_CACHED_BLOBS_SIDECAR) {
          this.producedBlobsSidecarCache.delete(key);
        }
      }
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
    const headState = this.stateCache.get(this.forkChoice.getHead().stateRoot);
    const finalizedState = this.checkpointStateCache.get(cp);
    if (headState) {
      this.opPool.pruneAll(headState, finalizedState);
    }
  }

  /**
   * perform heart beat for EL lest it logs warning that CL is not connected
   */
  private async exchangeTransitionConfiguration(): Promise<void> {
    const clConfig: TransitionConfigurationV1 = {
      terminalTotalDifficulty: numToQuantity(this.config.TERMINAL_TOTAL_DIFFICULTY),
      terminalBlockHash: bytesToData(this.config.TERMINAL_BLOCK_HASH),
      /** terminalBlockNumber has to be set to zero for now as per specs */
      terminalBlockNumber: numToQuantity(0),
    };

    const elConfigRes = await wrapError(this.executionEngine.exchangeTransitionConfigurationV1(clConfig));

    if (elConfigRes.err) {
      // Note: Will throw an error if:
      // - EL endpoint is offline, unreachable, port not exposed, etc
      // - JWT secret is not properly configured
      // - If there is a missmatch in configuration with Geth, see https://github.com/ethereum/go-ethereum/blob/0016eb7eeeb42568c8c20d0cb560ddfc9a938fad/eth/catalyst/api.go#L301
      this.successfulExchangeTransition = false;

      this.logger.warn("Could not validate transition configuration with execution client", {}, elConfigRes.err);
    } else {
      // Note: This code is useless when connected to Geth. If there's a configuration mismatch Geth returns an
      // error instead of its own transition configuration, so we can't do this comparision.
      const elConfig = elConfigRes.result;
      const keysToCheck: (keyof TransitionConfigurationV1)[] = ["terminalTotalDifficulty", "terminalBlockHash"];
      const errors: string[] = [];

      for (const key of keysToCheck) {
        if (elConfig[key] !== clConfig[key]) {
          errors.push(`different ${key} (cl ${clConfig[key]} el ${elConfig[key]})`);
        }
      }

      if (errors.length > 0) {
        this.logger.warn(`Transition configuration mismatch: ${errors.join(", ")}`);
      } else {
        // Only log once per successful call
        if (!this.successfulExchangeTransition) {
          this.logger.info("Validated transition configuration with execution client", clConfig);
          this.successfulExchangeTransition = true;
        }
      }
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
