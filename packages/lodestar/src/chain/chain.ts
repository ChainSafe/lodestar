/**
 * @module chain
 */

import fs from "node:fs";
import {
  BeaconStateAllForks,
  CachedBeaconStateAllForks,
  computeStartSlotAtEpoch,
  createCachedBeaconState,
  Index2PubkeyCache,
  PubkeyIndexMap,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {allForks, UintNum64, Root, phase0, Slot, RootHex, Epoch} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {fromHexString} from "@chainsafe/ssz";
import {GENESIS_EPOCH, ZERO_HASH} from "../constants/index.js";
import {IBeaconDb} from "../db/index.js";
import {CheckpointStateCache, StateContextCache} from "./stateCache/index.js";
import {IMetrics} from "../metrics/index.js";
import {BlockProcessor, PartiallyVerifiedBlockFlags} from "./blocks/index.js";
import {IBeaconClock, LocalClock} from "./clock/index.js";
import {ChainEventEmitter} from "./emitter.js";
import {handleChainEvents} from "./eventHandlers.js";
import {IBeaconChain, SSZObjectType, ProposerPreparationData} from "./interface.js";
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
import {IEth1ForBlockProduction} from "../eth1/index.js";
import {IExecutionEngine} from "../executionEngine/index.js";
import {PrecomputeNextEpochTransitionScheduler} from "./precomputeNextEpochTransition.js";
import {ReprocessController} from "./reprocess.js";
import {SeenAggregatedAttestations} from "./seenCache/seenAggregateAndProof.js";
import {BeaconProposerCache} from "./beaconProposerCache.js";

export class BeaconChain implements IBeaconChain {
  readonly genesisTime: UintNum64;
  readonly genesisValidatorsRoot: Root;
  readonly eth1: IEth1ForBlockProduction;
  readonly executionEngine: IExecutionEngine;
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
    }: {
      config: IBeaconConfig;
      db: IBeaconDb;
      logger: ILogger;
      metrics: IMetrics | null;
      anchorState: BeaconStateAllForks;
      eth1: IEth1ForBlockProduction;
      executionEngine: IExecutionEngine;
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

    const signal = this.abortController.signal;
    const emitter = new ChainEventEmitter();
    // by default, verify signatures on both main threads and worker threads
    const bls = opts.blsVerifyAllMainThread
      ? new BlsSingleThreadVerifier({metrics})
      : new BlsMultiThreadWorkerPool(opts, {logger, metrics, signal: this.abortController.signal});

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
        beaconProposerCache: this.beaconProposerCache,
        emitter,
        config,
        logger,
        metrics,
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

    handleChainEvents.bind(this)(this.abortController.signal);
  }

  close(): void {
    this.abortController.abort();
    this.stateCache.clear();
    this.checkpointStateCache.clear();
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

  persistInvalidSszObject(type: SSZObjectType, bytes: Uint8Array, suffix = ""): string | null {
    const now = new Date();
    // yyyy-MM-dd
    const date = now.toISOString().split("T")[0];
    // by default store to lodestar_archive of current dir
    const byDate = this.opts.persistInvalidSszObjectsDir
      ? `${this.opts.persistInvalidSszObjectsDir}/${date}`
      : `invalidSszObjects/${date}`;
    if (!fs.existsSync(byDate)) {
      fs.mkdirSync(byDate, {recursive: true});
    }
    const fileName = `${byDate}/${type}_${suffix}.ssz`;
    // as of Feb 17 2022 there are a lot of duplicate files stored with different date suffixes
    // remove date suffixes in file name, and check duplicate to avoid redundant persistence
    if (!fs.existsSync(fileName)) {
      fs.writeFileSync(fileName, bytes);
    }
    return fileName;
  }

  async updateBeaconProposerData(epoch: Epoch, proposers: ProposerPreparationData[]): Promise<void> {
    proposers.forEach((proposer) => {
      this.beaconProposerCache.add(epoch, proposer);
    });
  }
}
