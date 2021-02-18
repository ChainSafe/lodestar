/**
 * @module chain
 */

import {
  computeEpochAtSlot,
  computeForkDigest,
  computeStartSlotAtEpoch,
  phase0,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {
  Attestation,
  BeaconState,
  Checkpoint,
  ENRForkID,
  ForkDigest,
  Number64,
  Root,
  SignedBeaconBlock,
  Slot,
} from "@chainsafe/lodestar-types";
import {ILogger, intToBytes} from "@chainsafe/lodestar-utils";
import {TreeBacked} from "@chainsafe/ssz";
import {AbortController} from "abort-controller";
import {FAR_FUTURE_EPOCH} from "../constants";
import {IBeaconDb} from "../db";
import {CheckpointStateCache, StateContextCache} from "./stateCache";
import {IBeaconMetrics} from "../metrics";
import {notNullish} from "@chainsafe/lodestar-utils/src/notNullish";
import {AttestationPool, AttestationProcessor} from "./attestation";
import {BlockPool, BlockProcessor} from "./blocks";
import {IBeaconClock, LocalClock} from "./clock";
import {ChainEventEmitter} from "./emitter";
import {handleChainEvents} from "./eventHandlers";
import {IBeaconChain, ITreeStateContext} from "./interface";
import {IChainOptions} from "./options";
import {IStateRegenerator, QueuedStateRegenerator} from "./regen";
import {LodestarForkChoice} from "./forkChoice";
import {restoreStateCaches} from "./initState";

export interface IBeaconChainModules {
  opts: IChainOptions;
  config: IBeaconConfig;
  db: IBeaconDb;
  logger: ILogger;
  metrics: IBeaconMetrics;
  anchorState: TreeBacked<BeaconState>;
}

export class BeaconChain implements IBeaconChain {
  public forkChoice: IForkChoice;
  public clock: IBeaconClock;
  public emitter: ChainEventEmitter;
  public stateCache: StateContextCache;
  public checkpointStateCache: CheckpointStateCache;
  public regen: IStateRegenerator;
  public pendingAttestations: AttestationPool;
  public pendingBlocks: BlockPool;

  protected attestationProcessor: AttestationProcessor;
  protected blockProcessor: BlockProcessor;
  protected readonly config: IBeaconConfig;
  protected readonly db: IBeaconDb;
  protected readonly logger: ILogger;
  protected readonly metrics: IBeaconMetrics;
  protected readonly opts: IChainOptions;
  protected readonly genesisTime: Number64;
  /**
   * Internal event emitter is used internally to the chain to update chain state
   * Once event have been handled internally, they are re-emitted externally for downstream consumers
   */
  protected internalEmitter: ChainEventEmitter;
  private abortController: AbortController;

  public constructor({opts, config, db, logger, metrics, anchorState}: IBeaconChainModules) {
    this.opts = opts;
    this.config = config;
    this.db = db;
    this.logger = logger;
    this.metrics = metrics;

    this.genesisTime = anchorState.genesisTime;
    this.abortController = new AbortController();

    this.emitter = new ChainEventEmitter();
    this.internalEmitter = new ChainEventEmitter();

    this.clock = new LocalClock({
      config: this.config,
      emitter: this.internalEmitter,
      genesisTime: this.genesisTime,
      signal: this.abortController.signal,
    });
    this.forkChoice = new LodestarForkChoice({
      config,
      emitter: this.internalEmitter,
      currentSlot: this.clock.currentSlot,
      anchorState,
    });
    this.stateCache = new StateContextCache();
    this.checkpointStateCache = new CheckpointStateCache(this.config);
    restoreStateCaches(config, this.stateCache, this.checkpointStateCache, anchorState);
    this.regen = new QueuedStateRegenerator({
      config: this.config,
      emitter: this.internalEmitter,
      forkChoice: this.forkChoice,
      stateCache: this.stateCache,
      checkpointStateCache: this.checkpointStateCache,
      db: this.db,
      signal: this.abortController.signal,
    });
    this.pendingAttestations = new AttestationPool({
      config: this.config,
    });
    this.pendingBlocks = new BlockPool({
      config: this.config,
    });
    this.attestationProcessor = new AttestationProcessor({
      config: this.config,
      forkChoice: this.forkChoice,
      emitter: this.internalEmitter,
      clock: this.clock,
      regen: this.regen,
    });
    this.blockProcessor = new BlockProcessor({
      config: this.config,
      forkChoice: this.forkChoice,
      clock: this.clock,
      regen: this.regen,
      emitter: this.internalEmitter,
      checkpointStateCache: this.checkpointStateCache,
      signal: this.abortController.signal,
    });
    handleChainEvents.bind(this)(this.abortController.signal);
  }

  public async close(): Promise<void> {
    this.abortController.abort();
    this.stateCache.clear();
    this.checkpointStateCache.clear();
  }

  public getGenesisTime(): Number64 {
    return this.genesisTime;
  }

  public getHeadStateContext(): ITreeStateContext {
    // head state should always exist
    const head = this.forkChoice.getHead();
    const headState =
      this.checkpointStateCache.getLatest({
        root: head.blockRoot,
        epoch: Infinity,
      }) || this.stateCache.get(head.stateRoot);
    if (!headState) throw Error("headState does not exist");
    return headState;
  }
  public getHeadState(): TreeBacked<BeaconState> {
    //head state should always have epoch ctx
    return this.getHeadStateContext().state.getOriginalState() as TreeBacked<BeaconState>;
  }
  public getHeadEpochContext(): phase0.EpochContext {
    // head should always have epoch ctx
    return this.getHeadStateContext().epochCtx;
  }

  public async getHeadStateContextAtCurrentEpoch(): Promise<ITreeStateContext> {
    const currentEpochStartSlot = computeStartSlotAtEpoch(this.config, this.clock.currentEpoch);
    const head = this.forkChoice.getHead();
    const bestSlot = currentEpochStartSlot > head.slot ? currentEpochStartSlot : head.slot;
    return await this.regen.getBlockSlotState(head.blockRoot, bestSlot);
  }

  public async getHeadStateContextAtCurrentSlot(): Promise<ITreeStateContext> {
    return await this.regen.getBlockSlotState(this.forkChoice.getHeadRoot(), this.clock.currentSlot);
  }

  public async getHeadBlock(): Promise<SignedBeaconBlock | null> {
    const headSummary = this.forkChoice.getHead();
    const unfinalizedBlock = await this.db.block.get(headSummary.blockRoot);
    if (unfinalizedBlock) {
      return unfinalizedBlock;
    }
    return await this.db.blockArchive.get(headSummary.slot);
  }

  public async getCanonicalBlockAtSlot(slot: Slot): Promise<SignedBeaconBlock | null> {
    const finalizedCheckpoint = this.forkChoice.getFinalizedCheckpoint();
    if (finalizedCheckpoint.epoch > computeEpochAtSlot(this.config, slot)) {
      return this.db.blockArchive.get(slot);
    }
    const summary = this.forkChoice.getCanonicalBlockSummaryAtSlot(slot);
    if (!summary) {
      return null;
    }
    return this.db.block.get(summary.blockRoot);
  }

  public async getStateContextByBlockRoot(blockRoot: Root): Promise<ITreeStateContext | null> {
    const blockSummary = this.forkChoice.getBlock(blockRoot);
    if (!blockSummary) {
      return null;
    }
    try {
      return await this.regen.getState(blockSummary.stateRoot);
    } catch (e) {
      return null;
    }
  }

  /** Returned blocks have the same ordering as `slots` */
  public async getUnfinalizedBlocksAtSlots(slots: Slot[]): Promise<SignedBeaconBlock[]> {
    if (slots.length === 0) {
      return [];
    }

    const slotsSet = new Set(slots);
    const blockRootsPerSlot = new Map<Slot, Promise<SignedBeaconBlock | null>>();

    // these blocks are on the same chain to head
    for (const summary of this.forkChoice.iterateBlockSummaries(this.forkChoice.getHeadRoot())) {
      if (slotsSet.has(summary.slot)) {
        blockRootsPerSlot.set(summary.slot, this.db.block.get(summary.blockRoot));
      }
    }

    const unfinalizedBlocks = await Promise.all(slots.map((slot) => blockRootsPerSlot.get(slot)));
    return unfinalizedBlocks.filter(notNullish);
  }

  public getFinalizedCheckpoint(): Checkpoint {
    return this.forkChoice.getFinalizedCheckpoint();
  }

  public async receiveAttestation(attestation: Attestation): Promise<void> {
    this.attestationProcessor
      .processAttestationJob({attestation, validSignature: false})
      .catch(() => /* unreachable */ ({}));
  }

  public async receiveBlock(signedBlock: SignedBeaconBlock, trusted = false): Promise<void> {
    this.blockProcessor
      .processBlockJob({
        signedBlock,
        reprocess: false,
        prefinalized: trusted,
        validSignatures: trusted,
        validProposerSignature: trusted,
      })
      .catch(() => /* unreachable */ ({}));
  }

  public async processChainSegment(signedBlocks: SignedBeaconBlock[], trusted = false): Promise<void> {
    return this.blockProcessor.processChainSegment({
      signedBlocks,
      reprocess: false,
      prefinalized: trusted,
      validSignatures: trusted,
      validProposerSignature: trusted,
    });
  }

  public getForkDigest(): ForkDigest {
    const {state} = this.getHeadStateContext();
    return computeForkDigest(this.config, state.fork.currentVersion, state.genesisValidatorsRoot);
  }

  public getENRForkID(): ENRForkID {
    const state = this.getHeadState();
    const currentVersion = state.fork.currentVersion;
    const nextVersion =
      this.config.params.ALL_FORKS &&
      this.config.params.ALL_FORKS.find((fork) =>
        this.config.types.Version.equals(currentVersion, intToBytes(fork.previousVersion, 4))
      );

    const forkDigest = this.getForkDigest();

    return {
      forkDigest,
      nextForkVersion: nextVersion
        ? intToBytes(nextVersion.currentVersion, 4)
        : (currentVersion.valueOf() as Uint8Array),
      nextForkEpoch: nextVersion ? nextVersion.epoch : FAR_FUTURE_EPOCH,
    };
  }
}
