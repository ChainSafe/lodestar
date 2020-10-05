/**
 * @module chain
 */

import {AbortController} from "abort-controller";
import {toHexString, TreeBacked} from "@chainsafe/ssz";
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
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  blockToHeader,
  computeEpochAtSlot,
  computeForkDigest,
  computeStartSlotAtEpoch,
  EpochContext,
} from "@chainsafe/lodestar-beacon-state-transition";
import {ILogger, intToBytes, toJson} from "@chainsafe/lodestar-utils";
import {IForkChoice, ForkChoice, ProtoArray, IBlockSummary} from "@chainsafe/lodestar-fork-choice";

import {EMPTY_SIGNATURE, GENESIS_SLOT, FAR_FUTURE_EPOCH, ZERO_HASH} from "../constants";
import {IBeaconDb} from "../db";
import {IEth1Provider} from "../eth1";
import {IBeaconMetrics} from "../metrics";
import {GenesisBuilder} from "./genesis/genesis";
import {ChainEventEmitter} from "./emitter";
import {ForkChoiceStore} from "./forkChoice";

import {IBeaconChain, IBlockProcessJob} from "./interface";
import {IChainOptions} from "./options";
import {AttestationPool, AttestationProcessor} from "./attestation";
import {BlockPool, BlockProcessor} from "./blocks";
import {IBeaconClock, LocalClock} from "./clock";
import {sortBlocks} from "../sync/utils";
import {getEmptyBlock} from "./genesis/util";
import {ITreeStateContext} from "../db/api/beacon/stateContextCache";
import {notNullish} from "../util/notNullish";
import {IStateRegenerator, QueuedStateRegenerator} from "./regen";
import {AttestationError, AttestationErrorCode, BlockError, BlockErrorCode} from "./errors";

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
  public attestationPool!: AttestationPool;
  public blockPool!: BlockPool;
  private attestationProcessor!: AttestationProcessor;
  private blockProcessor!: BlockProcessor;
  private readonly config: IBeaconConfig;
  private readonly db: IBeaconDb;
  private readonly eth1Provider: IEth1Provider;
  private readonly logger: ILogger;
  private readonly metrics: IBeaconMetrics;
  private readonly opts: IChainOptions;
  private _currentForkDigest!: ForkDigest;
  private genesisTime: Number64 = 0;
  private abortController?: AbortController;

  public constructor(opts: IChainOptions, {config, db, eth1Provider, logger, metrics}: IBeaconChainModules) {
    this.opts = opts;
    this.config = config;
    this.db = db;
    this.eth1Provider = eth1Provider;
    this.logger = logger;
    this.metrics = metrics;
    this.emitter = new ChainEventEmitter();
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
      emitter: this.emitter,
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
      emitter: this.emitter,
      forkChoice: this.forkChoice,
      db: this.db,
      signal: this.abortController!.signal,
    });
    this.attestationProcessor = new AttestationProcessor({
      config: this.config,
      forkChoice: this.forkChoice,
      emitter: this.emitter,
      clock: this.clock,
      regen: this.regen,
    });
    this.attestationPool = new AttestationPool({
      config: this.config,
      processor: this.attestationProcessor,
    });
    this.blockProcessor = new BlockProcessor({
      config: this.config,
      forkChoice: this.forkChoice,
      clock: this.clock,
      regen: this.regen,
      emitter: this.emitter,
      signal: this.abortController!.signal,
    });
    this.blockPool = new BlockPool({
      config: this.config,
      processor: this.blockProcessor,
    });
    this._currentForkDigest = computeForkDigest(this.config, state.fork.currentVersion, state.genesisValidatorsRoot);
    this.emitter.on("forkVersion", this.handleForkVersionChanged);
    this.emitter.on("clock:slot", this.onClockSlot);
    this.emitter.on("checkpoint", this.onCheckpoint);
    this.emitter.on("justified", this.onJustified);
    this.emitter.on("finalized", this.onFinalized);
    this.emitter.on("forkChoice:justified", this.onForkChoiceJustified);
    this.emitter.on("forkChoice:finalized", this.onForkChoiceFinalized);
    this.emitter.on("forkChoice:head", this.onForkChoiceHead);
    this.emitter.on("forkChoice:reorg", this.onForkChoiceReorg);
    this.emitter.on("attestation", this.onAttestation);
    this.emitter.on("block", this.onBlock);
    this.emitter.on("error:attestation", this.onErrorAttestation);
    this.emitter.on("error:block", this.onErrorBlock);
  }

  public async stop(): Promise<void> {
    this.abortController!.abort();
    this.emitter.removeListener("forkVersion", this.handleForkVersionChanged);
    this.emitter.removeListener("clock:slot", this.onClockSlot);
    this.emitter.removeListener("checkpoint", this.onCheckpoint);
    this.emitter.removeListener("justified", this.onJustified);
    this.emitter.removeListener("finalized", this.onFinalized);
    this.emitter.removeListener("forkChoice:justified", this.onForkChoiceJustified);
    this.emitter.removeListener("forkChoice:finalized", this.onForkChoiceFinalized);
    this.emitter.removeListener("forkChoice:head", this.onForkChoiceHead);
    this.emitter.removeListener("forkChoice:reorg", this.onForkChoiceReorg);
    this.emitter.removeListener("attestation", this.onAttestation);
    this.emitter.removeListener("block", this.onBlock);
    this.emitter.removeListener("error:attestation", this.onErrorAttestation);
    this.emitter.removeListener("error:block", this.onErrorBlock);
  }

  public get currentForkDigest(): ForkDigest {
    return this._currentForkDigest;
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

  public async getENRForkID(): Promise<ENRForkID> {
    const state = await this.getHeadState();
    const currentVersion = state.fork.currentVersion;
    const nextVersion =
      this.config.params.ALL_FORKS &&
      this.config.params.ALL_FORKS.find((fork) =>
        this.config.types.Version.equals(currentVersion, intToBytes(fork.previousVersion, 4))
      );
    return {
      forkDigest: this.currentForkDigest,
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
      emitter: this.emitter,
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

  private handleForkVersionChanged = async (): Promise<void> => {
    this._currentForkDigest = await this.getCurrentForkDigest();
    this.emitter.emit("forkDigest", this._currentForkDigest);
  };

  private async getCurrentForkDigest(): Promise<ForkDigest> {
    const {state} = await this.getHeadStateContext();
    return computeForkDigest(this.config, state.fork.currentVersion, state.genesisValidatorsRoot);
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
    this.metrics.currentSlot.set(state.slot);
    this.metrics.previousJustifiedEpoch.set(state.previousJustifiedCheckpoint.epoch);
    this.metrics.currentJustifiedEpoch.set(state.currentJustifiedCheckpoint.epoch);
    this.metrics.currentFinalizedEpoch.set(state.finalizedCheckpoint.epoch);
    return state;
  }

  private onJustified = async (cp: Checkpoint, stateContext: ITreeStateContext): Promise<void> => {
    this.logger.important("Checkpoint justified", this.config.types.Checkpoint.toJson(cp));
    this.metrics.previousJustifiedEpoch.set(stateContext.state.previousJustifiedCheckpoint.epoch);
    this.metrics.currentJustifiedEpoch.set(cp.epoch);
  };

  private onFinalized = async (cp: Checkpoint): Promise<void> => {
    this.logger.important("Checkpoint finalized", this.config.types.Checkpoint.toJson(cp));
    this.metrics.currentFinalizedEpoch.set(cp.epoch);
  };

  private onCheckpoint = async (cp: Checkpoint, stateContext: ITreeStateContext): Promise<void> => {
    this.logger.verbose("Checkpoint processed", this.config.types.Checkpoint.toJson(cp));
    await this.db.checkpointStateCache.add(cp, stateContext);
    this.metrics.currentEpochLiveValidators.set(stateContext.epochCtx.currentShuffling.activeIndices.length);
    const preStateCtx = await this.getStateContextByBlockRoot(stateContext.state.latestBlockHeader.parentRoot);
    if (preStateCtx) {
      const justifiedCheckpoint = stateContext.state.currentJustifiedCheckpoint;
      const justifiedEpoch = justifiedCheckpoint.epoch;
      const preJustifiedEpoch = preStateCtx.state.currentJustifiedCheckpoint.epoch;
      if (justifiedEpoch > preJustifiedEpoch) {
        this.emitter.emit("justified", justifiedCheckpoint, stateContext);
      }
      const finalizedCheckpoint = stateContext.state.finalizedCheckpoint;
      const finalizedEpoch = finalizedCheckpoint.epoch;
      const preFinalizedEpoch = preStateCtx.state.finalizedCheckpoint.epoch;
      if (finalizedEpoch > preFinalizedEpoch) {
        this.emitter.emit("finalized", finalizedCheckpoint, stateContext);
      }
    }
  };

  private onClockSlot = async (slot: Slot): Promise<void> => {
    this.logger.verbose("Clock slot", {slot});
    this.forkChoice.updateTime(slot);
    this.blockPool.onClockSlot(slot);
    await this.attestationPool.onClockSlot(slot);
  };

  private onForkChoiceJustified = async (cp: Checkpoint): Promise<void> => {
    this.logger.verbose("Fork choice justified", this.config.types.Checkpoint.toJson(cp));
  };

  private onForkChoiceFinalized = async (cp: Checkpoint): Promise<void> => {
    this.logger.verbose("Fork choice finalized", this.config.types.Checkpoint.toJson(cp));
  };

  private onForkChoiceHead = async (head: IBlockSummary): Promise<void> => {
    this.logger.verbose("New chain head", {
      headSlot: head.slot,
      headRoot: toHexString(head.blockRoot),
    });
  };

  private onForkChoiceReorg = async (head: IBlockSummary, oldHead: IBlockSummary, depth: number): Promise<void> => {
    this.logger.verbose("Chain reorg", {
      depth,
    });
  };

  private onAttestation = async (attestation: Attestation): Promise<void> => {
    this.logger.debug("Attestation processed", {
      slot: attestation.data.slot,
      index: attestation.data.index,
      targetRoot: toHexString(attestation.data.target.root),
      aggregationBits: this.config.types.CommitteeBits.toJson(attestation.aggregationBits),
    });
  };

  private onBlock = async (
    block: SignedBeaconBlock,
    postStateContext: ITreeStateContext,
    job: IBlockProcessJob
  ): Promise<void> => {
    this.logger.debug("Block processed", {
      slot: block.message.slot,
      root: toHexString(this.config.types.BeaconBlock.hashTreeRoot(block.message)),
    });
    this.metrics.currentSlot.set(block.message.slot);
    await this.db.stateCache.add(postStateContext);
    if (!job.reprocess) {
      await this.db.block.add(block);
    }
    if (!job.trusted) {
      await this.attestationPool.onBlock(block);
    }
    await this.db.processBlockOperations(block);
    this.blockPool.onBlock(block);
    await this.attestationPool.onBlock(block);
  };

  private onErrorAttestation = async (err: AttestationError): Promise<void> => {
    if (!(err instanceof AttestationError)) {
      this.logger.error("Non AttestationError received:", err);
      return;
    }
    this.logger.debug("Attestation error", toJson(err));
    const attestationRoot = this.config.types.Attestation.hashTreeRoot(err.job.attestation);
    switch (err.type.code) {
      case AttestationErrorCode.ERR_FUTURE_SLOT:
        this.logger.debug("Add attestation to pool", {
          reason: err.type.code,
          attestationRoot: toHexString(attestationRoot),
        });
        this.attestationPool.putBySlot(err.type.attestationSlot, err.job);
        break;
      case AttestationErrorCode.ERR_UNKNOWN_TARGET_ROOT:
        this.logger.debug("Add attestation to pool", {
          reason: err.type.code,
          attestationRoot: toHexString(attestationRoot),
        });
        this.attestationPool.putByBlock(err.type.root, err.job);
        break;
      case AttestationErrorCode.ERR_UNKNOWN_HEAD_BLOCK:
        this.attestationPool.putByBlock(err.type.beaconBlockRoot, err.job);
        break;
      default:
        await this.db.attestation.remove(err.job.attestation);
    }
  };

  private onErrorBlock = async (err: BlockError): Promise<void> => {
    if (!(err instanceof BlockError)) {
      this.logger.error("Non BlockError received:", err);
      return;
    }
    this.logger.debug("Block error", toJson(err));
    const blockRoot = this.config.types.BeaconBlock.hashTreeRoot(err.job.signedBlock.message);
    switch (err.type.code) {
      case BlockErrorCode.ERR_FUTURE_SLOT:
        this.logger.debug("Add block to pool", {
          reason: err.type.code,
          blockRoot: toHexString(blockRoot),
        });
        this.blockPool.addBySlot(err.job);
        break;
      case BlockErrorCode.ERR_PARENT_UNKNOWN:
        this.logger.debug("Add block to pool", {
          reason: err.type.code,
          blockRoot: toHexString(blockRoot),
        });
        this.blockPool.addByParent(err.job);
        break;
      case BlockErrorCode.ERR_INCORRECT_PROPOSER:
      case BlockErrorCode.ERR_REPEAT_PROPOSAL:
      case BlockErrorCode.ERR_STATE_ROOT_MISMATCH:
      case BlockErrorCode.ERR_PER_BLOCK_PROCESSING_ERROR:
      case BlockErrorCode.ERR_BLOCK_IS_NOT_LATER_THAN_PARENT:
      case BlockErrorCode.ERR_UNKNOWN_PROPOSER:
        await this.db.badBlock.put(blockRoot);
        this.logger.warn("Found bad block", {
          blockRoot: toHexString(blockRoot),
          error: toJson(err),
        });
        break;
    }
  };
}
