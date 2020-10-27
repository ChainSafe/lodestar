/**
 * @module chain
 */

import {
  computeEpochAtSlot,
  computeForkDigest,
  computeStartSlotAtEpoch,
  EpochContext,
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
import {ITreeStateContext} from "../db/api/beacon/stateContextCache";
import {IBeaconMetrics} from "../metrics";
import {notNullish} from "../util/notNullish";
import {AttestationPool, AttestationProcessor} from "./attestation";
import {BlockPool, BlockProcessor} from "./blocks";
import {IBeaconClock, LocalClock} from "./clock";
import {ChainEventEmitter} from "./emitter";
import {handleChainEvents} from "./eventHandlers";
import {IBeaconChain} from "./interface";
import {IChainOptions} from "./options";
import {IStateRegenerator, QueuedStateRegenerator} from "./regen";
import {EventedForkChoice} from "./forkChoice/forkChoice";

export interface IBeaconChainModules {
  opts: IChainOptions;
  config: IBeaconConfig;
  db: IBeaconDb;
  logger: ILogger;
  metrics: IBeaconMetrics;
  anchorState: BeaconState;
}

export class BeaconChain implements IBeaconChain {
  public forkChoice: IForkChoice;
  public clock: IBeaconClock;
  public emitter: ChainEventEmitter;
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
    this.forkChoice = new EventedForkChoice({
      config,
      emitter: this.internalEmitter,
      currentSlot: this.clock.currentSlot,
      anchorState,
    });
    this.regen = new QueuedStateRegenerator({
      config: this.config,
      emitter: this.internalEmitter,
      forkChoice: this.forkChoice,
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
      signal: this.abortController.signal,
    });
    handleChainEvents.bind(this)(this.abortController.signal);
  }

  public async close(): Promise<void> {
    this.abortController.abort();
  }

  public getGenesisTime(): Number64 {
    return this.genesisTime;
  }

  public async getHeadStateContext(): Promise<ITreeStateContext> {
    //head state should always exist
    const head = this.forkChoice.getHead();
    const headStateRoot =
      (await this.db.checkpointStateCache.getLatest({
        root: head.blockRoot,
        epoch: Infinity,
      })) || (await this.regen.getState(head.stateRoot));
    if (!headStateRoot) throw Error("headStateRoot does not exist");
    return headStateRoot;
  }
  public async getHeadState(): Promise<TreeBacked<BeaconState>> {
    //head state should always have epoch ctx
    return (await this.getHeadStateContext()).state;
  }
  public async getHeadEpochContext(): Promise<EpochContext> {
    //head should always have epoch ctx
    return (await this.getHeadStateContext()).epochCtx;
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
    const stateContext = await this.db.stateCache.get(blockSummary.stateRoot);
    if (!stateContext) {
      return null;
    }
    return stateContext;
  }

  public async getUnfinalizedBlocksAtSlots(slots: Slot[]): Promise<SignedBeaconBlock[] | null> {
    if (!slots) {
      return null;
    }
    const blockRoots = this.forkChoice
      .iterateBlockSummaries(this.forkChoice.getHeadRoot())
      .filter((summary) => slots.includes(summary.slot))
      .map((summary) => summary.blockRoot);
    // these blocks are on the same chain to head
    const unfinalizedBlocks = await Promise.all(blockRoots.map((blockRoot) => this.db.block.get(blockRoot)));
    return unfinalizedBlocks.filter(notNullish);
  }

  public async getFinalizedCheckpoint(): Promise<Checkpoint> {
    return this.forkChoice.getFinalizedCheckpoint();
  }

  public async receiveAttestation(attestation: Attestation): Promise<void> {
    this.attestationProcessor
      .processAttestationJob({attestation, validSignature: false})
      .catch(() => /* unreachable */ ({}));
  }

  public async receiveBlock(signedBlock: SignedBeaconBlock, trusted = false, reprocess = false): Promise<void> {
    this.blockProcessor.processBlockJob({signedBlock, trusted, reprocess}).catch(() => /* unreachable */ ({}));
  }

  public async getForkDigest(): Promise<ForkDigest> {
    const {state} = await this.getHeadStateContext();
    return computeForkDigest(this.config, state.fork.currentVersion, state.genesisValidatorsRoot);
  }

  public async getENRForkID(): Promise<ENRForkID> {
    const state = await this.getHeadState();
    const currentVersion = state.fork.currentVersion;
    const nextVersion =
      this.config.params.ALL_FORKS &&
      this.config.params.ALL_FORKS.find((fork) =>
        this.config.types.Version.equals(currentVersion, intToBytes(fork.previousVersion, 4))
      );
    const forkDigest = await this.getForkDigest();
    return {
      forkDigest,
      nextForkVersion: nextVersion
        ? intToBytes(nextVersion.currentVersion, 4)
        : (currentVersion.valueOf() as Uint8Array),
      nextForkEpoch: nextVersion ? nextVersion.epoch : FAR_FUTURE_EPOCH,
    };
  }
}
