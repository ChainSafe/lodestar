/**
 * @module chain
 */

import {EventEmitter} from "events";
import {toHexString, TreeBacked} from "@chainsafe/ssz";
import {
  Attestation,
  BeaconState,
  Checkpoint,
  ENRForkID,
  ForkDigest,
  SignedBeaconBlock,
  Slot,
  Uint16,
  Uint64,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  computeEpochAtSlot,
  computeForkDigest,
  EpochContext,
  ZERO_HASH} from "@chainsafe/lodestar-beacon-state-transition";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {intToBytes} from "@chainsafe/lodestar-utils";

import {EMPTY_SIGNATURE, GENESIS_SLOT, FAR_FUTURE_EPOCH} from "../constants";
import {IBeaconDb} from "../db";
import {IEth1Notifier} from "../eth1";
import {IBeaconMetrics} from "../metrics";
import {GenesisBuilder} from "./genesis/genesis";
import {ArrayDagLMDGHOST, ILMDGHOST} from "./forkChoice";

import {ChainEventEmitter, IAttestationProcessor, IBeaconChain} from "./interface";
import {IChainOptions} from "./options";
import {AttestationProcessor} from "./attestation";
import {IBeaconClock} from "./clock/interface";
import {LocalClock} from "./clock/local/LocalClock";
import {BlockProcessor} from "./blocks";
import {sortBlocks} from "../sync/utils";
import {getEmptyBlock} from "./genesis/util";
import {ITreeStateContext} from "../db/api/beacon/stateContextCache";
import {sleep} from "../util/sleep";

export interface IBeaconChainModules {
  config: IBeaconConfig;
  db: IBeaconDb;
  eth1: IEth1Notifier;
  logger: ILogger;
  metrics: IBeaconMetrics;
  forkChoice?: ILMDGHOST;
}

export interface IBlockProcessJob {
  signedBlock: SignedBeaconBlock;
  trusted: boolean;
  reprocess: boolean;
}

export class BeaconChain extends (EventEmitter as { new(): ChainEventEmitter }) implements IBeaconChain {

  public readonly chain: string;
  public forkChoice: ILMDGHOST;
  public chainId: Uint16;
  public networkId: Uint64;
  public clock: IBeaconClock;
  private readonly config: IBeaconConfig;
  private readonly db: IBeaconDb;
  private readonly eth1: IEth1Notifier;
  private readonly logger: ILogger;
  private readonly metrics: IBeaconMetrics;
  private readonly opts: IChainOptions;
  private blockProcessor: BlockProcessor;
  private _currentForkDigest: ForkDigest;
  private attestationProcessor: IAttestationProcessor;

  public constructor(
    opts: IChainOptions, {config, db, eth1, logger, metrics, forkChoice}: IBeaconChainModules) {
    super();
    this.opts = opts;
    this.chain = opts.name;
    this.config = config;
    this.db = db;
    this.eth1 = eth1;
    this.logger = logger;
    this.metrics = metrics;
    this.forkChoice = forkChoice || new ArrayDagLMDGHOST(config);
    this.chainId = 0; // TODO make this real
    this.networkId = BigInt(0); // TODO make this real
    this.attestationProcessor = new AttestationProcessor(this, this.forkChoice, {config, db, logger});
    this.blockProcessor = new BlockProcessor(
      config, logger, db, this.forkChoice, metrics, this, this.attestationProcessor,
    );
  }

  public async getHeadStateContext(): Promise<ITreeStateContext> {
    //head state should always exist
    return (await this.db.stateCache.get(this.forkChoice.headStateRoot()));
  }
  public async getHeadState(): Promise<TreeBacked<BeaconState>> {
    //head state should always have epoch ctx
    return (await this.db.stateCache.get(this.forkChoice.headStateRoot())).state;
  }
  public async getHeadEpochContext(): Promise<EpochContext> {
    //head should always have epoch ctx
    return (await this.db.stateCache.get(this.forkChoice.headStateRoot())).epochCtx;
  }

  public async getHeadBlock(): Promise<SignedBeaconBlock|null> {
    return this.db.block.get(this.forkChoice.headBlockRoot());
  }

  public async getBlockAtSlot(slot: Slot): Promise<SignedBeaconBlock|null> {
    const finalizedCheckpoint = this.forkChoice.getFinalized();
    if (finalizedCheckpoint.epoch > computeEpochAtSlot(this.config, slot)) {
      return this.db.blockArchive.get(slot);
    }
    const summary = this.forkChoice.getCanonicalBlockSummaryAtSlot(slot);
    if (!summary) {
      return null;
    }
    return this.db.block.get(summary.blockRoot);
  }

  public async getUnfinalizedBlocksAtSlots(slots: Slot[]): Promise<SignedBeaconBlock[]|null> {
    if (!slots) {
      return null;
    }
    const blockRoots = slots.map((slot) => {
      const summary = this.forkChoice.getCanonicalBlockSummaryAtSlot(slot);
      return summary? summary.blockRoot : null;
    }).filter((blockRoot) => !!blockRoot);
    // these blocks are on the same chain to head
    return await Promise.all(blockRoots.map(
      (blockRoot) => this.db.block.get(blockRoot)));
  }

  public async getFinalizedCheckpoint(): Promise<Checkpoint> {
    return this.forkChoice.getFinalized();
  }

  public async start(): Promise<void> {
    this.logger.verbose("Starting chain");
    // if we run from scratch, we want to wait for genesis state
    const state = await this.waitForState();
    const epochCtx = new EpochContext(this.config);
    epochCtx.loadState(state);
    await this.db.stateCache.add({state, epochCtx});
    await this.waitForGenesisTime(state.genesisTime);
    this.logger.info("Chain started, waiting blocks and attestations");
    this.clock = new LocalClock(this.config, state.genesisTime);
    await this.clock.start();
    this.forkChoice.start(state.genesisTime, this.clock);
    await this.blockProcessor.start();
    this._currentForkDigest =  computeForkDigest(this.config, state.fork.currentVersion, state.genesisValidatorsRoot);
    this.on("forkVersion", this.handleForkVersionChanged);
    await this.restoreHeadState(state, epochCtx);
    await this.eth1.start();
  }

  public async stop(): Promise<void> {
    await this.forkChoice.stop();

    if (this.clock) {
      await this.clock.stop();
    }

    await this.blockProcessor.stop();
    this.removeListener("forkVersion", this.handleForkVersionChanged);
  }

  public get currentForkDigest(): ForkDigest {
    return this._currentForkDigest;
  }

  public async receiveAttestation(attestation: Attestation): Promise<void> {
    return this.attestationProcessor.receiveAttestation(attestation);
  }

  public async receiveBlock(signedBlock: SignedBeaconBlock, trusted = false, reprocess = false): Promise<void> {
    this.blockProcessor.receiveBlock(signedBlock, trusted, reprocess);
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
    this.logger.info(`Initializing beacon chain with state root ${toHexString(stateRoot)}`
            + ` and block root ${toHexString(blockRoot)}, number of validator: ${genesisState.validators.length}`
    );
    const justifiedFinalizedCheckpoint = {
      root: blockRoot,
      epoch: computeEpochAtSlot(this.config, genesisBlock.slot)
    };
    this.forkChoice.addBlock({
      slot: genesisBlock.slot,
      blockRoot: blockRoot,
      stateRoot: stateRoot,
      parentRoot: Buffer.alloc(32),
      justifiedCheckpoint: justifiedFinalizedCheckpoint,
      finalizedCheckpoint: justifiedFinalizedCheckpoint,
    });
    const epochCtx = new EpochContext(this.config);
    epochCtx.loadState(genesisState);
    await this.db.stateCache.add({state: genesisState, epochCtx});
    // Determine whether a genesis state already in
    // the database matches what we were provided
    const storedGenesisBlock = await this.getBlockAtSlot(GENESIS_SLOT);
    if (storedGenesisBlock !== null &&
      !this.config.types.Root.equals(genesisBlock.stateRoot, storedGenesisBlock.message.stateRoot)) {
      throw new Error("A genesis state with different configuration was detected! Please clean the database.");
    }
    const signedGenesisBlock = {message: genesisBlock, signature: EMPTY_SIGNATURE};
    await Promise.all([
      this.db.block.add(signedGenesisBlock),
      this.db.blockArchive.add(signedGenesisBlock),
      this.db.stateArchive.add(genesisState),
    ]);
    this.logger.info("Beacon chain initialized");
  }

  public async getENRForkID(): Promise<ENRForkID> {
    const state = await this.getHeadState();
    const currentVersion = state.fork.currentVersion;
    const nextVersion = this.config.params.ALL_FORKS && this.config.params.ALL_FORKS.find(
      fork => this.config.types.Version.equals(currentVersion, intToBytes(fork.previousVersion, 4)));
    return {
      forkDigest: this.currentForkDigest,
      nextForkVersion: nextVersion? intToBytes(nextVersion.currentVersion, 4) : currentVersion.valueOf() as Uint8Array,
      nextForkEpoch: nextVersion? nextVersion.epoch : FAR_FUTURE_EPOCH,
    };
  }

  public async waitForBlockProcessed(blockRoot: Uint8Array): Promise<void> {
    let listener: (signedBlock: SignedBeaconBlock) => void;
    await new Promise((resolve) => {
      listener = (signedBlock) => {
        const root = this.config.types.BeaconBlock.hashTreeRoot(signedBlock.message);
        if (this.config.types.Root.equals(root, blockRoot)) {
          resolve();
        }
      };
      this.on("processedBlock", listener);
    });
    this.removeListener("processedBlock", listener);
  }

  /**
   * Restore state cache and forkchoice from last finalized state.
   */
  private async restoreHeadState(lastKnownState: TreeBacked<BeaconState>, epochCtx: EpochContext): Promise<void> {
    const finalizedCheckpoint = lastKnownState.finalizedCheckpoint;
    const finalizedEpoch = finalizedCheckpoint.epoch;
    const finalizedRoot = finalizedCheckpoint.root;
    this.logger.info(`Found last known finalized state at epoch #${finalizedEpoch} root ${toHexString(finalizedRoot)}`);
    this.logger.profile("restoreHeadState");
    this.db.stateCache.add({state: lastKnownState, epochCtx});
    // there might be blocks in the archive we need to reprocess
    const finalizedBlocks = await this.db.blockArchive.values({gte: lastKnownState.slot});
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
    this.logger.info(`Found ${sortedBlocks.length} nonfinalized blocks in database from slot ` +
      `${firstSlot} to ${lastSlot}`);
    const isStateNotGenesis = lastKnownState.slot > GENESIS_SLOT;
    const stateRoot = this.config.types.BeaconState.hashTreeRoot(lastKnownState);
    const finalizedBlock = sortedBlocks.find(block => {
      return (block.message.slot === lastKnownState.slot) &&
      // at genesis the genesis block's state root is not equal to genesis state root
      (isStateNotGenesis? this.config.types.Root.equals(block.message.stateRoot, stateRoot) : true);
    });
    if (!finalizedBlock) {
      throw new Error(`Cannot find block for finalized state at slot ${lastKnownState.slot}`);
    } else {
      this.logger.info(`Found finalized block at slot ${finalizedBlock.message.slot},
        root=${toHexString(this.config.types.BeaconBlock.hashTreeRoot(finalizedBlock.message))}`);
    }
    await this.initForkChoice(lastKnownState, finalizedBlock);
    // no need to process the finalized block
    const processedBlocks = sortedBlocks.filter((block) => block.message.slot > finalizedBlock.message.slot);
    if (!processedBlocks.length) {
      this.logger.info("No need to reprocess blocks");
      return;
    }
    firstSlot = processedBlocks[0].message.slot;
    lastSlot = processedBlocks[processedBlocks.length - 1].message.slot;
    this.logger.info(`Start processing from slot ${firstSlot} to ${lastSlot} to rebuild state cache and forkchoice`);
    await Promise.all([
      ...processedBlocks.map(block => this.receiveBlock(block, true, true)),
      this.waitForBlockProcessed(this.config.types.BeaconBlock.hashTreeRoot(lastBlock.message))
    ]);
    this.logger.important(`Finish restoring chain head from ${sortedBlocks.length} blocks`);
    this.logger.profile("restoreHeadState");
  }

  private async initForkChoice(
    lastKnownState: TreeBacked<BeaconState>, finalizedBlock: SignedBeaconBlock): Promise<void> {
    const isStateNotGenesis = lastKnownState.slot > GENESIS_SLOT;
    const finalizedSlot = finalizedBlock.message.slot;
    const blockCheckpoint: Checkpoint = {
      root: this.config.types.BeaconBlock.hashTreeRoot(finalizedBlock.message),
      epoch: computeEpochAtSlot(this.config, finalizedSlot)
    };
    // add justified block to forkchoice so "this.justified" in forkchoice really map to a block
    if (isStateNotGenesis) {
      const preJustifiedBlock = await this.db.blockArchive.getByRoot(lastKnownState.currentJustifiedCheckpoint.root);
      let preFinalizedBlocks = await this.db.blockArchive.values({
        gt: preJustifiedBlock.message.slot, lt: finalizedSlot});
      preFinalizedBlocks = sortBlocks([preJustifiedBlock, ...preFinalizedBlocks]);
      const firstSlot = preFinalizedBlocks[0].message.slot;
      const lastSlot = preFinalizedBlocks[preFinalizedBlocks.length - 1].message.slot;
      this.logger.info(`Initialize forkchoice with pre-finalized blocks from ${firstSlot} to ${lastSlot}
        and finalized block ${finalizedSlot}`);
      preFinalizedBlocks.forEach((block) => {
        this.forkChoice.addBlock({
          slot: block.message.slot,
          blockRoot: this.config.types.BeaconBlock.hashTreeRoot(block.message),
          stateRoot: block.message.stateRoot.valueOf() as Uint8Array,
          parentRoot: block.message.parentRoot.valueOf() as Uint8Array,
          // don't care the below justified and finalized checkpoint as we don't use them
          justifiedCheckpoint: {epoch: 0, root: ZERO_HASH},
          finalizedCheckpoint: {epoch: 0, root: ZERO_HASH}
        });
      });
    }
    this.forkChoice.addBlock({
      slot: finalizedSlot,
      blockRoot: this.config.types.BeaconBlock.hashTreeRoot(finalizedBlock.message),
      stateRoot: finalizedBlock.message.stateRoot.valueOf() as Uint8Array,
      parentRoot: finalizedBlock.message.parentRoot.valueOf() as Uint8Array,
      justifiedCheckpoint: (isStateNotGenesis)? lastKnownState.currentJustifiedCheckpoint : blockCheckpoint,
      finalizedCheckpoint: (isStateNotGenesis)? lastKnownState.finalizedCheckpoint : blockCheckpoint
    });
  }

  private async handleForkVersionChanged(): Promise<void> {
    this._currentForkDigest = await this.getCurrentForkDigest();
    this.emit("forkDigest", this._currentForkDigest);
  }

  private async getCurrentForkDigest(): Promise<ForkDigest> {
    const {state} = await this.getHeadStateContext();
    return computeForkDigest(this.config, state.fork.currentVersion, state.genesisValidatorsRoot);
  }

  // If we don't have a state yet, we have to wait for genesis state
  private async waitForState(): Promise<TreeBacked<BeaconState>> {
    let state: TreeBacked<BeaconState> = await this.db.stateArchive.lastValue();
    if (!state) {
      this.logger.info("Chain not started, listening for genesis block");
      const builder = new GenesisBuilder(this.config, {eth1: this.eth1, db: this.db, logger: this.logger});
      state = await builder.waitForGenesis();
      await this.initializeBeaconChain(state);
    }
    // set metrics based on beacon state
    this.metrics.currentSlot.set(state.slot);
    this.metrics.previousJustifiedEpoch.set(state.previousJustifiedCheckpoint.epoch);
    this.metrics.currentJustifiedEpoch.set(state.currentJustifiedCheckpoint.epoch);
    this.metrics.currentFinalizedEpoch.set(state.finalizedCheckpoint.epoch);
    return state;
  }

  /**
   * Wait until now >= genesisTime
   */
  private async waitForGenesisTime(genesisTime: number): Promise<void> {
    let now = Math.floor(Date.now() / 1000);
    while (genesisTime - now > 0) {
      // wait 15s or time to genesis, whichever is shorter
      const diff = Math.min(genesisTime - now, 15000);
      // print time remaining in minutes, 1 decimal point accuracy
      const waitTime = Math.floor((genesisTime - now) / 6) / 10 + " minute(s)";
      this.logger.info("Waiting for genesis", {waitTime: waitTime});
      await sleep(diff);
      now = Math.floor(Date.now() / 1000);
    }
  }

}
