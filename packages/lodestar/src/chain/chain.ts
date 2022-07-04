/**
 * @module chain
 */

import path from "node:path";
import {
  BeaconStateAllForks,
  CachedBeaconStateAllForks,
  computeStartSlotAtEpoch,
  createCachedBeaconState,
  Index2PubkeyCache,
  PubkeyIndexMap,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks, UintNum64, Root, phase0, Slot, RootHex, Epoch, ValidatorIndex} from "@chainsafe/lodestar-types";
import {CheckpointWithHex, IForkChoice, ProtoBlock} from "@chainsafe/lodestar-fork-choice";
import {ILogger, toHex} from "@chainsafe/lodestar-utils";
import {CompositeTypeAny, fromHexString, TreeView, Type} from "@chainsafe/ssz";
import {GENESIS_EPOCH, ZERO_HASH} from "../constants/index.js";
import {IBeaconDb} from "../db/index.js";
import {IMetrics} from "../metrics/index.js";
import {IEth1ForBlockProduction} from "../eth1/index.js";
import {IExecutionEngine, IExecutionBuilder} from "../execution/index.js";
import {ensureDir, writeIfNotExist} from "../util/file.js";
import {CheckpointStateCache, StateContextCache} from "./stateCache/index.js";
import {BlockProcessor, PartiallyVerifiedBlockFlags} from "./blocks/index.js";
import {IBeaconClock, LocalClock} from "./clock/index.js";
import {ChainEventEmitter} from "./emitter.js";
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
import {PrecomputeNextEpochTransitionScheduler} from "./precomputeNextEpochTransition.js";
import {ReprocessController} from "./reprocess.js";
import {SeenAggregatedAttestations} from "./seenCache/seenAggregateAndProof.js";
import {SeenBlockAttesters} from "./seenCache/seenBlockAttesters.js";
import {BeaconProposerCache} from "./beaconProposerCache.js";
import {ChainEvent} from "./index.js";

export class BeaconChain implements IBeaconChain {
  readonly genesisTime: UintNum64;
  readonly genesisValidatorsRoot: Root;
  readonly eth1: IEth1ForBlockProduction;
  readonly executionEngine: IExecutionEngine;
  readonly executionBuilder?: IExecutionBuilder;
  // Expose config for convenience in modularized functions
  readonly config: IBeaconConfig;
  readonly anchorStateLatestBlockSlot: Slot;

  bls: IBlsVerifier;
  forkChoice: IForkChoice;
  clock: IBeaconClock;
  emitter: ChainEventEmitter;
  stateCache: StateContextCache;
  checkpointStateCache: CheckpointStateCache;
  regen: IStateRegenerator;
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

  protected readonly blockProcessor: BlockProcessor;
  protected readonly db: IBeaconDb;
  protected readonly logger: ILogger;
  protected readonly metrics: IMetrics | null;
  protected readonly opts: IChainOptions;
  private readonly archiver: Archiver;
  private abortController = new AbortController();

  constructor(
    opts: IChainOptions,
    {
      config,
      db,
      logger,
      metrics,
      anchorState,
      eth1,
      executionEngine,
      executionBuilder,
    }: {
      config: IBeaconConfig;
      db: IBeaconDb;
      logger: ILogger;
      metrics: IMetrics | null;
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

    const clock = new LocalClock({config, emitter, genesisTime: this.genesisTime, signal});
    const stateCache = new StateContextCache({metrics});
    const checkpointStateCache = new CheckpointStateCache({metrics});

    this.seenAggregatedAttestations = new SeenAggregatedAttestations(metrics);
    this.seenContributionAndProof = new SeenContributionAndProof(metrics);

    // Initialize single global instance of state caches
    this.pubkey2index = new PubkeyIndexMap();
    this.index2pubkey = [];

    this.beaconProposerCache = new BeaconProposerCache(opts);

    // Restore state caches
    const cachedState = createCachedBeaconState(anchorState, {
      config,
      pubkey2index: this.pubkey2index,
      index2pubkey: this.index2pubkey,
    });
    const {checkpoint} = computeAnchorCheckpoint(config, anchorState);
    stateCache.add(cachedState);
    checkpointStateCache.add(checkpoint, cachedState);

    const forkChoice = initializeForkChoice(
      config,
      emitter,
      clock.currentSlot,
      cachedState,
      opts.proposerBoostEnabled,
      metrics
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

    const lightClientServer = new LightClientServer({config, db, metrics, emitter, logger});

    this.reprocessController = new ReprocessController(this.metrics);

    this.blockProcessor = new BlockProcessor(
      {
        clock,
        bls,
        regen,
        executionEngine,
        eth1,
        db,
        forkChoice,
        lightClientServer,
        stateCache,
        checkpointStateCache,
        seenAggregatedAttestations: this.seenAggregatedAttestations,
        seenBlockAttesters: this.seenBlockAttesters,
        beaconProposerCache: this.beaconProposerCache,
        reprocessController: this.reprocessController,
        emitter,
        config,
        logger,
        metrics,
        persistInvalidSszValue: this.persistInvalidSszValue.bind(this),
        persistInvalidSszView: this.persistInvalidSszView.bind(this),
      },
      opts,
      signal
    );

    this.forkChoice = forkChoice;
    this.clock = clock;
    this.regen = regen;
    this.bls = bls;
    this.checkpointStateCache = checkpointStateCache;
    this.stateCache = stateCache;
    this.emitter = emitter;
    this.lightClientServer = lightClientServer;

    this.archiver = new Archiver(db, this, logger, signal, opts);
    new PrecomputeNextEpochTransitionScheduler(this, this.config, metrics, this.logger, signal);

    metrics?.opPool.aggregatedAttestationPoolSize.addCollect(() => this.onScrapeMetrics());

    // Event handlers
    this.emitter.addListener(ChainEvent.clockSlot, this.onClockSlot.bind(this));
    this.emitter.addListener(ChainEvent.clockEpoch, this.onClockEpoch.bind(this));
    this.emitter.addListener(ChainEvent.forkChoiceFinalized, this.onForkChoiceFinalized.bind(this));
    this.emitter.addListener(ChainEvent.forkChoiceJustified, this.onForkChoiceJustified.bind(this));
    this.emitter.addListener(ChainEvent.forkChoiceHead, this.onForkChoiceHead.bind(this));
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
    if (!headState) throw Error("headState does not exist");
    return headState;
  }

  async getHeadStateAtCurrentEpoch(): Promise<CachedBeaconStateAllForks> {
    const currentEpochStartSlot = computeStartSlotAtEpoch(this.clock.currentEpoch);
    const head = this.forkChoice.getHead();
    const bestSlot = currentEpochStartSlot > head.slot ? currentEpochStartSlot : head.slot;
    return await this.regen.getBlockSlotState(head.blockRoot, bestSlot, RegenCaller.getDuties);
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
    return await this.db.block.get(fromHexString(block.blockRoot));
  }

  async processBlock(block: allForks.SignedBeaconBlock, flags?: PartiallyVerifiedBlockFlags): Promise<void> {
    return await this.blockProcessor.processBlockJob({...flags, block});
  }

  async processChainSegment(blocks: allForks.SignedBeaconBlock[], flags?: PartiallyVerifiedBlockFlags): Promise<void> {
    return await this.blockProcessor.processChainSegment(blocks.map((block) => ({...flags, block})));
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

  /**
   * Returns Promise that resolves either on block found or once 1 slot passes.
   * Used to handle unknown block root for both unaggregated and aggregated attestations.
   * @returns true if blockFound
   */
  waitForBlockOfAttestation(slot: Slot, root: RootHex): Promise<boolean> {
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
  }

  private onClockSlot(slot: Slot): void {
    this.logger.verbose("Clock slot", {slot});

    // CRITICAL UPDATE
    this.forkChoice.updateTime(slot);

    this.metrics?.clockSlot.set(slot);

    this.attestationPool.prune(slot);
    this.aggregatedAttestationPool.prune(slot);
    this.syncCommitteeMessagePool.prune(slot);
    this.seenSyncCommitteeMessages.prune(slot);
    this.reprocessController.onSlot(slot);
  }

  private onClockEpoch(epoch: Epoch): void {
    this.seenAttesters.prune(epoch);
    this.seenAggregators.prune(epoch);
    this.seenAggregatedAttestations.prune(epoch);
    this.seenBlockAttesters.prune(epoch);
    this.beaconProposerCache.prune(epoch);
  }

  private onForkChoiceHead(head: ProtoBlock): void {
    const delaySec = this.clock.secFromSlot(head.slot);
    this.logger.verbose("New chain head", {
      headSlot: head.slot,
      headRoot: head.blockRoot,
      delaySec,
    });
    this.syncContributionAndProofPool.prune(head.slot);
    this.seenContributionAndProof.prune(head.slot);

    if (this.metrics) {
      this.metrics.headSlot.set(head.slot);
      // Only track "recent" blocks. Otherwise sync can distort this metrics heavily.
      // We want to track recent blocks coming from gossip, unknown block sync, and API.
      if (delaySec < 64 * this.config.SECONDS_PER_SLOT) {
        this.metrics.elapsedTimeTillBecomeHead.observe(delaySec);
      }
    }
  }

  private onForkChoiceJustified(this: BeaconChain, cp: CheckpointWithHex): void {
    this.logger.verbose("Fork choice justified", {epoch: cp.epoch, root: cp.rootHex});
  }

  private onForkChoiceFinalized(this: BeaconChain, cp: CheckpointWithHex): void {
    this.logger.verbose("Fork choice finalized", {epoch: cp.epoch, root: cp.rootHex});
    this.seenBlockProposers.prune(computeStartSlotAtEpoch(cp.epoch));

    // TODO: Improve using regen here
    const headState = this.stateCache.get(this.forkChoice.getHead().stateRoot);
    if (headState) {
      this.opPool.pruneAll(headState);
    }
  }

  async updateBeaconProposerData(epoch: Epoch, proposers: ProposerPreparationData[]): Promise<void> {
    proposers.forEach((proposer) => {
      this.beaconProposerCache.add(epoch, proposer);
    });
  }
}
