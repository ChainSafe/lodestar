/**
 * @module chain
 */

import fs from "fs";
import {ForkName} from "@chainsafe/lodestar-params";
import {CachedBeaconState, computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IForkChoice, ITransitionStore} from "@chainsafe/lodestar-fork-choice";
import {allForks, ForkDigest, Number64, Root, phase0, Slot} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {fromHexString, TreeBacked} from "@chainsafe/ssz";
import {LightClientUpdater} from "@chainsafe/lodestar-light-client/server";
import {AbortController} from "@chainsafe/abort-controller";
import {GENESIS_EPOCH, ZERO_HASH} from "../constants";
import {IBeaconDb} from "../db";
import {CheckpointStateCache, StateContextCache} from "./stateCache";
import {IMetrics} from "../metrics";
import {BlockProcessor, PartiallyVerifiedBlockFlags} from "./blocks";
import {IBeaconClock, LocalClock} from "./clock";
import {ChainEventEmitter} from "./emitter";
import {handleChainEvents} from "./eventHandlers";
import {IBeaconChain, SSZObjectType} from "./interface";
import {IChainOptions} from "./options";
import {IStateRegenerator, QueuedStateRegenerator, RegenCaller} from "./regen";
import {initializeForkChoice} from "./forkChoice";
import {restoreStateCaches} from "./initState";
import {IBlsVerifier, BlsSingleThreadVerifier, BlsMultiThreadWorkerPool} from "./bls";
import {
  SeenAttesters,
  SeenAggregators,
  SeenBlockProposers,
  SeenSyncCommitteeMessages,
  SeenContributionAndProof,
} from "./seenCache";
import {
  AggregatedAttestationPool,
  AttestationPool,
  SyncCommitteeMessagePool,
  SyncContributionAndProofPool,
  OpPool,
} from "./opPools";
import {ForkDigestContext, IForkDigestContext} from "../util/forkDigestContext";
import {LightClientIniter} from "./lightClient";
import {Archiver} from "./archiver";

export class BeaconChain implements IBeaconChain {
  readonly genesisTime: Number64;
  readonly genesisValidatorsRoot: Root;

  bls: IBlsVerifier;
  forkChoice: IForkChoice;
  clock: IBeaconClock;
  emitter = new ChainEventEmitter();
  stateCache: StateContextCache;
  checkpointStateCache: CheckpointStateCache;
  regen: IStateRegenerator;
  forkDigestContext: IForkDigestContext;
  lightclientUpdater: LightClientUpdater;
  lightClientIniter: LightClientIniter;

  // Ops pool
  readonly attestationPool = new AttestationPool();
  readonly aggregatedAttestationPool = new AggregatedAttestationPool();
  readonly syncCommitteeMessagePool = new SyncCommitteeMessagePool();
  readonly syncContributionAndProofPool = new SyncContributionAndProofPool();
  readonly opPool = new OpPool();

  // Gossip seen cache
  readonly seenAttesters = new SeenAttesters();
  readonly seenAggregators = new SeenAggregators();
  readonly seenBlockProposers = new SeenBlockProposers();
  readonly seenSyncCommitteeMessages = new SeenSyncCommitteeMessages();
  readonly seenContributionAndProof = new SeenContributionAndProof();

  protected readonly blockProcessor: BlockProcessor;
  protected readonly config: IBeaconConfig;
  protected readonly db: IBeaconDb;
  protected readonly logger: ILogger;
  protected readonly metrics: IMetrics | null;
  protected readonly opts: IChainOptions;
  /**
   * Internal event emitter is used internally to the chain to update chain state
   * Once event have been handled internally, they are re-emitted externally for downstream consumers
   */
  protected internalEmitter = new ChainEventEmitter();
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
      transitionStore,
    }: {
      config: IBeaconConfig;
      db: IBeaconDb;
      logger: ILogger;
      metrics: IMetrics | null;
      anchorState: TreeBacked<allForks.BeaconState>;
      transitionStore: ITransitionStore | null;
    }
  ) {
    this.opts = opts;
    this.config = config;
    this.db = db;
    this.logger = logger;
    this.metrics = metrics;
    this.genesisTime = anchorState.genesisTime;
    this.genesisValidatorsRoot = anchorState.genesisValidatorsRoot.valueOf() as Uint8Array;

    this.forkDigestContext = new ForkDigestContext(config, this.genesisValidatorsRoot);

    const signal = this.abortController.signal;
    const emitter = this.internalEmitter; // All internal compoments emit to the internal emitter first
    const bls = opts.useSingleThreadVerifier
      ? new BlsSingleThreadVerifier()
      : new BlsMultiThreadWorkerPool({logger, metrics, signal: this.abortController.signal});

    const clock = new LocalClock({config, emitter, genesisTime: this.genesisTime, signal});
    const stateCache = new StateContextCache({metrics});
    const checkpointStateCache = new CheckpointStateCache({metrics});
    const cachedState = restoreStateCaches(config, stateCache, checkpointStateCache, anchorState);
    const forkChoice = initializeForkChoice(config, transitionStore, emitter, clock.currentSlot, cachedState, metrics);
    const regen = new QueuedStateRegenerator({
      config,
      forkChoice,
      stateCache,
      checkpointStateCache,
      db,
      metrics,
      signal,
    });
    this.blockProcessor = new BlockProcessor(
      {
        clock,
        bls,
        regen,
        db,
        forkChoice,
        stateCache,
        checkpointStateCache,
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

    this.lightclientUpdater = new LightClientUpdater(this.db);
    this.lightClientIniter = new LightClientIniter({config: this.config, forkChoice, db: this.db, stateCache});
    this.archiver = new Archiver(db, this, logger, signal);

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

  getGenesisTime(): Number64 {
    return this.genesisTime;
  }

  getHeadState(): CachedBeaconState<allForks.BeaconState> {
    // head state should always exist
    const head = this.forkChoice.getHead();
    const headState =
      this.checkpointStateCache.getLatest(head.blockRoot, Infinity) || this.stateCache.get(head.stateRoot);
    if (!headState) throw Error("headState does not exist");
    return headState;
  }

  async getHeadStateAtCurrentEpoch(): Promise<CachedBeaconState<allForks.BeaconState>> {
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

  /** Returned blocks have the same ordering as `slots` */
  async getUnfinalizedBlocksAtSlots(slots: Slot[]): Promise<allForks.SignedBeaconBlock[]> {
    if (slots.length === 0) {
      return [];
    }

    const slotsSet = new Set(slots);
    const minSlot = Math.min(...slots); // Slots must have length > 0
    const blockRootsPerSlot = new Map<Slot, Promise<allForks.SignedBeaconBlock | null>>();

    // these blocks are on the same chain to head
    for (const block of this.forkChoice.iterateAncestorBlocks(this.forkChoice.getHeadRoot())) {
      if (block.slot < minSlot) {
        break;
      } else if (slotsSet.has(block.slot)) {
        blockRootsPerSlot.set(block.slot, this.db.block.get(fromHexString(block.blockRoot)));
      }
    }

    const unfinalizedBlocks = await Promise.all(slots.map((slot) => blockRootsPerSlot.get(slot)));
    return unfinalizedBlocks.filter((block): block is allForks.SignedBeaconBlock => block != null);
  }

  async processBlock(block: allForks.SignedBeaconBlock, flags?: PartiallyVerifiedBlockFlags): Promise<void> {
    return await this.blockProcessor.processBlockJob({...flags, block});
  }

  async processChainSegment(blocks: allForks.SignedBeaconBlock[], flags?: PartiallyVerifiedBlockFlags): Promise<void> {
    return await this.blockProcessor.processChainSegment(blocks.map((block) => ({...flags, block})));
  }

  getHeadForkName(): ForkName {
    return this.config.getForkName(this.forkChoice.getHead().slot);
  }
  getClockForkName(): ForkName {
    return this.config.getForkName(this.clock.currentSlot);
  }
  getHeadForkDigest(): ForkDigest {
    return this.forkDigestContext.forkName2ForkDigest(this.getHeadForkName());
  }
  getClockForkDigest(): ForkDigest {
    return this.forkDigestContext.forkName2ForkDigest(this.getClockForkName());
  }

  getStatus(): phase0.Status {
    const head = this.forkChoice.getHead();
    const finalizedCheckpoint = this.forkChoice.getFinalizedCheckpoint();
    return {
      // fork_digest: The node's ForkDigest (compute_fork_digest(current_fork_version, genesis_validators_root)) where
      // - current_fork_version is the fork version at the node's current epoch defined by the wall-clock time (not necessarily the epoch to which the node is sync)
      // - genesis_validators_root is the static Root found in state.genesis_validators_root
      forkDigest: this.forkDigestContext.forkName2ForkDigest(this.config.getForkName(this.clock.currentSlot)),
      // finalized_root: state.finalized_checkpoint.root for the state corresponding to the head block (Note this defaults to Root(b'\x00' * 32) for the genesis finalized checkpoint).
      finalizedRoot: finalizedCheckpoint.epoch === GENESIS_EPOCH ? ZERO_HASH : finalizedCheckpoint.root,
      finalizedEpoch: finalizedCheckpoint.epoch,
      // TODO: PERFORMANCE: Memoize to prevent re-computing every time
      headRoot: fromHexString(head.blockRoot),
      headSlot: head.slot,
    };
  }

  persistInvalidSszObject(type: SSZObjectType, bytes: Uint8Array, suffix = ""): string | null {
    if (!this.persistInvalidSszObject) {
      return null;
    }
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
    const fileName = `${byDate}/${type}_${suffix}_${Date.now()}.ssz`;
    fs.writeFileSync(fileName, bytes);
    return fileName;
  }
}
