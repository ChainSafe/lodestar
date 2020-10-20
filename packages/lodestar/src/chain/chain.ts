/**
 * @module chain
 */

import {
  blockToHeader,
  computeEpochAtSlot,
  computeForkDigest,
  computeStartSlotAtEpoch,
  EpochContext,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ForkChoice, IForkChoice, ProtoArray} from "@chainsafe/lodestar-fork-choice";
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
  Uint16,
  Uint64,
} from "@chainsafe/lodestar-types";
import {ILogger, intToBytes} from "@chainsafe/lodestar-utils";
import {toHexString, TreeBacked} from "@chainsafe/ssz";
import {AbortController} from "abort-controller";
import {EMPTY_SIGNATURE, FAR_FUTURE_EPOCH, GENESIS_SLOT, ZERO_HASH} from "../constants";
import {IBeaconDb} from "../db";
import {ITreeStateContext} from "../db/api/beacon/stateContextCache";
import {IEth1Provider} from "../eth1";
import {IBeaconMetrics} from "../metrics";
import {sortBlocks} from "../sync/utils";
import {notNullish} from "../util/notNullish";
import {AttestationPool, AttestationProcessor} from "./attestation";
import {BlockPool, BlockProcessor} from "./blocks";
import {IBeaconClock, LocalClock} from "./clock";
import {ChainEventEmitter} from "./emitter";
import {ForkChoiceStore} from "./forkChoice";
import {GenesisBuilder} from "./genesis/genesis";
import {getEmptyBlock} from "./genesis/util";
import {handleChainEvents} from "./eventHandlers";
import {IBeaconChain} from "./interface";
import {IChainOptions} from "./options";
import {IStateRegenerator, QueuedStateRegenerator} from "./regen";

export interface IBeaconChainModules {
  config: IBeaconConfig;
  db: IBeaconDb;
  eth1Provider: IEth1Provider;
  logger: ILogger;
  metrics: IBeaconMetrics;
  forkChoice?: ForkChoice;
}

export class BeaconChain implements IBeaconChain {
  public forkChoice!: IForkChoice;
  public chainId: Uint16;
  public networkId: Uint64;
  public clock!: IBeaconClock;
  public emitter: ChainEventEmitter;
  public regen!: IStateRegenerator;
  public pendingAttestations!: AttestationPool;
  public pendingBlocks!: BlockPool;

  protected attestationProcessor!: AttestationProcessor;
  protected blockProcessor!: BlockProcessor;
  protected readonly config: IBeaconConfig;
  protected readonly db: IBeaconDb;
  protected readonly eth1Provider: IEth1Provider;
  protected readonly logger: ILogger;
  protected readonly metrics: IBeaconMetrics;
  protected readonly opts: IChainOptions;
  protected genesisTime: Number64 = 0;
  /**
   * Internal event emitter is used internally to the chain to update chain state
   * Once event have been handled internally, they are re-emitted externally for downstream consumers
   */
  protected internalEmitter: ChainEventEmitter;
  private abortController?: AbortController;

  public constructor(opts: IChainOptions, {config, db, eth1Provider, logger, metrics}: IBeaconChainModules) {
    this.opts = opts;
    this.config = config;
    this.db = db;
    this.eth1Provider = eth1Provider;
    this.logger = logger;
    this.metrics = metrics;
    this.emitter = new ChainEventEmitter();
    this.internalEmitter = new ChainEventEmitter();
    this.chainId = 0; // TODO make this real
    this.networkId = BigInt(0); // TODO make this real
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
    const blockRoots = slots
      .map((slot) => {
        const summary = this.forkChoice.getCanonicalBlockSummaryAtSlot(slot);
        return summary ? summary.blockRoot : null;
      })
      .filter(notNullish);
    // these blocks are on the same chain to head
    const unfinalizedBlocks = await Promise.all(blockRoots.map((blockRoot) => this.db.block.get(blockRoot)));
    return unfinalizedBlocks.filter(notNullish);
  }

  public async getFinalizedCheckpoint(): Promise<Checkpoint> {
    return this.forkChoice.getFinalizedCheckpoint();
  }

  public async start(): Promise<void> {
    this.abortController = new AbortController();
    this.logger.verbose("Starting chain");
    // if we run from scratch, we want to wait for genesis state
    const state = await this.waitForState();
    this.genesisTime = state.genesisTime;
    this.logger.info("Chain started, waiting blocks and attestations");
    this.clock = new LocalClock({
      config: this.config,
      emitter: this.internalEmitter,
      genesisTime: state.genesisTime,
      signal: this.abortController.signal,
    });
    const {forkChoice, checkpoint} = await this.initForkChoice(state);
    this.forkChoice = forkChoice;
    const epochCtx = new EpochContext(this.config);
    epochCtx.loadState(state);
    await this.db.stateCache.add({state, epochCtx});
    await this.db.checkpointStateCache.add(checkpoint, {state, epochCtx});
    this.regen = new QueuedStateRegenerator({
      config: this.config,
      emitter: this.internalEmitter,
      forkChoice: this.forkChoice,
      db: this.db,
      signal: this.abortController!.signal,
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
      signal: this.abortController!.signal,
    });
    handleChainEvents.bind(this)(this.abortController.signal);
  }

  public async stop(): Promise<void> {
    this.abortController!.abort();
  }

  public async receiveAttestation(attestation: Attestation): Promise<void> {
    this.attestationProcessor
      .processAttestationJob({attestation, validSignature: false})
      .catch(() => /* unreachable */ ({}));
  }

  public async receiveBlock(signedBlock: SignedBeaconBlock, trusted = false, reprocess = false): Promise<void> {
    this.blockProcessor.processBlockJob({signedBlock, trusted, reprocess}).catch(() => /* unreachable */ ({}));
  }

  public async initializeBeaconChain(genesisState: TreeBacked<BeaconState>): Promise<void> {
    // don't want to initialize from a genesis state if already run beacon node
    const lastKnownState = await this.db.stateArchive.lastValue();
    if (lastKnownState) {
      this.logger.info(`Found finalized state at slot ${lastKnownState.slot}, starting chain from there`);
      return;
    }
    const genesisBlock = getEmptyBlock();
    const stateRoot = this.config.types.BeaconState.hashTreeRoot(genesisState);
    genesisBlock.stateRoot = stateRoot;
    const blockRoot = this.config.types.BeaconBlock.hashTreeRoot(genesisBlock);
    this.logger.info("Initializing genesis state", {
      stateRoot: toHexString(stateRoot),
      blockRoot: toHexString(blockRoot),
      validatorCount: genesisState.validators.length,
    });
    // Determine whether a genesis state already in
    // the database matches what we were provided
    const storedGenesisBlock = await this.db.blockArchive.get(GENESIS_SLOT);
    if (
      storedGenesisBlock !== null &&
      !this.config.types.Root.equals(genesisBlock.stateRoot, storedGenesisBlock.message.stateRoot)
    ) {
      throw new Error("A genesis state with different configuration was detected! Please clean the database.");
    }
    const signedGenesisBlock = {message: genesisBlock, signature: EMPTY_SIGNATURE};
    await Promise.all([this.db.blockArchive.add(signedGenesisBlock), this.db.stateArchive.add(genesisState)]);
    this.logger.info("Beacon chain initialized");
  }

  /**
   * Initialize our chain from a weak subjectivity state.
   * @param state a weak subjectivity state
   */
  public async initializeWeakSubjectivityState(weakSubjectivityState: TreeBacked<BeaconState>): Promise<void> {
    // don't want to initialize if already run beacon node
    const lastKnownState = await this.db.stateArchive.lastValue();
    if (lastKnownState) {
      this.logger.info(`Found finalized state at slot ${lastKnownState.slot}, starting chain from there`);
      return;
    }
    await this.db.stateArchive.add(weakSubjectivityState);
    this.logger.info("Beacon chain initialized with weak subjectivity state at slot", weakSubjectivityState.slot);
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

  public async waitForBlockProcessed(blockRoot: Uint8Array): Promise<void> {
    await new Promise((resolve) => {
      const listener = (signedBlock: SignedBeaconBlock): void => {
        const root = this.config.types.BeaconBlock.hashTreeRoot(signedBlock.message);
        if (this.config.types.Root.equals(root, blockRoot)) {
          this.emitter.removeListener("block", listener);
          resolve();
        }
      };
      this.emitter.on("block", listener);
    });
  }

  /**
   * Restore state cache and forkchoice from last finalized state.
   */
  private async restoreHeadState(lastKnownState: TreeBacked<BeaconState>, epochCtx: EpochContext): Promise<void> {
    const stateRoot = this.config.types.BeaconState.hashTreeRoot(lastKnownState);
    this.logger.info("Restoring from last known state", {
      slot: lastKnownState.slot,
      epoch: computeEpochAtSlot(this.config, lastKnownState.slot),
      stateRoot: toHexString(stateRoot),
    });
    this.logger.profile("restoreHeadState");
    await this.db.stateCache.add({state: lastKnownState, epochCtx});
    // there might be blocks in the archive we need to reprocess
    const finalizedBlocks = await this.db.blockArchive.values({gt: lastKnownState.slot});
    // the block respective to finalized epoch still in block db
    const unfinalizedBlocks = await this.db.block.values();
    if (!unfinalizedBlocks || unfinalizedBlocks.length === 0) {
      return;
    }
    const sortedBlocks = finalizedBlocks.concat(sortBlocks(unfinalizedBlocks));
    const firstBlock = sortedBlocks[0];
    const lastBlock = sortedBlocks[sortedBlocks.length - 1];
    let firstSlot = firstBlock.message.slot;
    let lastSlot = lastBlock.message.slot;
    this.logger.info(
      `Found ${sortedBlocks.length} nonfinalized blocks in database from slot ` + `${firstSlot} to ${lastSlot}`
    );
    if (!sortedBlocks.length) {
      this.logger.info("No need to reprocess blocks");
      return;
    }
    firstSlot = sortedBlocks[0].message.slot;
    lastSlot = sortedBlocks[sortedBlocks.length - 1].message.slot;
    this.logger.info(`Start processing from slot ${firstSlot} to ${lastSlot} to rebuild state cache and forkchoice`);
    await Promise.all([
      ...sortedBlocks.map((block) => this.receiveBlock(block, true, true)),
      this.waitForBlockProcessed(this.config.types.BeaconBlock.hashTreeRoot(lastBlock.message)),
    ]);
    this.logger.important(`Finish restoring chain head from ${sortedBlocks.length} blocks`);
    this.logger.profile("restoreHeadState");
  }

  /**
   * Seeds the fork choice with an anchor state.
   * This state is set as the finalized state.
   */
  private async initForkChoice(
    anchorState: TreeBacked<BeaconState>
  ): Promise<{forkChoice: ForkChoice; checkpoint: Checkpoint}> {
    let blockHeader;
    let blockRoot;
    let justifiedCheckpoint;
    let finalizedCheckpoint;
    if (anchorState.latestBlockHeader.slot === GENESIS_SLOT) {
      const block = getEmptyBlock();
      block.stateRoot = this.config.types.BeaconState.hashTreeRoot(anchorState);
      blockHeader = blockToHeader(this.config, block);
      blockRoot = this.config.types.BeaconBlockHeader.hashTreeRoot(blockHeader);
      const blockCheckpoint = {
        root: blockRoot,
        epoch: 0,
      };
      justifiedCheckpoint = finalizedCheckpoint = blockCheckpoint;
    } else {
      blockHeader = this.config.types.BeaconBlockHeader.clone(anchorState.latestBlockHeader);
      if (this.config.types.Root.equals(blockHeader.stateRoot, ZERO_HASH)) {
        blockHeader.stateRoot = anchorState.hashTreeRoot();
      }
      blockRoot = this.config.types.BeaconBlockHeader.hashTreeRoot(blockHeader);
      finalizedCheckpoint = {
        root: this.config.types.BeaconBlockHeader.hashTreeRoot(blockHeader),
        epoch: computeEpochAtSlot(this.config, anchorState.slot),
      };
      // Justified checkpoint epoch must be set to finalized checkpoint epoch + 1
      // So that we don't allow the chain to initially justify with a block that isn't also finalizing the anchor state.
      // If that happens, we will create an invalid head state,
      // with the head not matching the fork choice justified and finalized epochs.
      justifiedCheckpoint = {
        root: finalizedCheckpoint.root,
        epoch: finalizedCheckpoint.epoch + 1,
      };
    }
    const fcStore = new ForkChoiceStore({
      emitter: this.internalEmitter,
      currentSlot: this.clock.currentSlot,
      justifiedCheckpoint,
      finalizedCheckpoint,
    });
    const protoArray = ProtoArray.initialize({
      slot: blockHeader.slot,
      parentRoot: toHexString(blockHeader.parentRoot),
      stateRoot: toHexString(blockHeader.stateRoot),
      blockRoot: toHexString(blockRoot),
      justifiedEpoch: justifiedCheckpoint.epoch,
      finalizedEpoch: finalizedCheckpoint.epoch,
    });
    return {
      forkChoice: new ForkChoice({
        config: this.config,
        fcStore,
        protoArray,
        queuedAttestations: new Set(),
      }),
      checkpoint: finalizedCheckpoint,
    };
  }

  // If we don't have a state yet, we have to wait for genesis state
  private async waitForState(): Promise<TreeBacked<BeaconState>> {
    let state = await this.db.stateArchive.lastValue();
    if (!state) {
      this.logger.info("Chain not started, listening for genesis block");
      const builder = new GenesisBuilder(this.config, {
        eth1Provider: this.eth1Provider,
        logger: this.logger,
        signal: this.abortController?.signal,
      });
      const genesisResult = await builder.waitForGenesis();
      state = genesisResult.state;
      await this.initializeBeaconChain(state);
    }
    // set metrics based on beacon state
    this.metrics.headSlot.set(state.slot);
    this.metrics.previousJustifiedEpoch.set(state.previousJustifiedCheckpoint.epoch);
    this.metrics.currentJustifiedEpoch.set(state.currentJustifiedCheckpoint.epoch);
    this.metrics.finalizedEpoch.set(state.finalizedCheckpoint.epoch);
    return state;
  }
}
