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
  Eth1Data,
  ForkDigest,
  SignedBeaconBlock,
  Uint16,
  Uint64,
  Slot,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {computeEpochAtSlot, computeForkDigest, EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {intToBytes} from "@chainsafe/lodestar-utils";

import {EMPTY_SIGNATURE, GENESIS_SLOT} from "../constants";
import {IBeaconDb} from "../db";
import {IEth1Notifier} from "../eth1";
import {IBeaconMetrics} from "../metrics";
import {getEmptyBlock, initializeBeaconStateFromEth1, isValidGenesisState} from "./genesis/genesis";
import {ILMDGHOST, ArrayDagLMDGHOST} from "./forkChoice";

import {ChainEventEmitter, IAttestationProcessor, IBeaconChain} from "./interface";
import {IChainOptions} from "./options";
import {AttestationProcessor} from "./attestation";
import {IBeaconClock} from "./clock/interface";
import {LocalClock} from "./clock/local/LocalClock";
import {BlockProcessor} from "./blocks";
import {sortBlocks} from "../sync/utils";

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

const MAX_VERSION = Buffer.from([255, 255, 255, 255]);
export class BeaconChain extends (EventEmitter as { new(): ChainEventEmitter }) implements IBeaconChain {

  public readonly chain: string;
  public forkChoice: ILMDGHOST;
  public chainId: Uint16;
  public networkId: Uint64;
  public clock: IBeaconClock;
  public epochCtx: EpochContext;
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
    this.epochCtx = new EpochContext(config);
    this.db = db;
    this.eth1 = eth1;
    this.logger = logger;
    this.metrics = metrics;
    this.forkChoice = forkChoice || new ArrayDagLMDGHOST(config);
    this.chainId = 0; // TODO make this real
    this.networkId = 0n; // TODO make this real
    this.attestationProcessor = new AttestationProcessor(this, this.forkChoice, {config, db, logger});
    this.blockProcessor = new BlockProcessor(
      config, logger, db, this.epochCtx, this.forkChoice, metrics, this, this.attestationProcessor,
    );
  }

  public async getHeadState(): Promise<BeaconState|null> {
    return this.db.stateCache.get(this.forkChoice.headStateRoot());
  }

  public async getHeadBlock(): Promise<SignedBeaconBlock|null> {
    return this.db.block.get(this.forkChoice.headBlockRoot());
  }

  public async getBlockAtSlot(slot: Slot): Promise<SignedBeaconBlock|null> {
    const finalizedCheckpoint = this.forkChoice.getFinalized();
    if (finalizedCheckpoint.epoch > computeEpochAtSlot(this.config, slot)) {
      return this.db.blockArchive.get(slot);
    }
    const summary = this.forkChoice.getBlockSummaryAtSlot(slot);
    if (!summary) {
      return null;
    }
    return this.db.block.get(summary.blockRoot);
  }

  public async getFinalizedCheckpoint(): Promise<Checkpoint> {
    return this.forkChoice.getFinalized();
  }

  public async start(): Promise<void> {
    this.logger.verbose("Starting chain");
    // if we run from scratch, we want to wait for genesis state
    const state = await this.waitForState();
    this.epochCtx.loadState(state);
    this.logger.info("Chain started, waiting blocks and attestations");
    this.clock = new LocalClock(this.config, state.genesisTime);
    await this.clock.start();
    this.forkChoice.start(state.genesisTime, this.clock);
    await this.blockProcessor.start();
    this._currentForkDigest =  computeForkDigest(this.config, state.fork.currentVersion, state.genesisValidatorsRoot);
    this.on("forkDigestChanged", this.handleForkDigestChanged);
    await this.restoreHeadState(state);
  }

  public async stop(): Promise<void> {
    await this.forkChoice.stop();

    if (this.clock) {
      await this.clock.stop();
    }

    await this.blockProcessor.stop();
    this.removeListener("forkDigestChanged", this.handleForkDigestChanged);
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
            + ` and genesis block root ${toHexString(blockRoot)}`
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
    await this.db.stateCache.add(genesisState);
    // Determine whether a genesis state already in
    // the database matches what we were provided
    const storedGenesisBlock = await this.getBlockAtSlot(GENESIS_SLOT);
    if (storedGenesisBlock !== null &&
      !this.config.types.Root.equals(genesisBlock.stateRoot, storedGenesisBlock.message.stateRoot)) {
      throw new Error("A genesis state with different configuration was detected! Please clean the database.");
    }
    await Promise.all([
      this.db.block.add({message: genesisBlock, signature: EMPTY_SIGNATURE}),
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
      nextForkVersion: nextVersion? intToBytes(nextVersion.currentVersion, 4) : MAX_VERSION,
      nextForkEpoch: nextVersion? nextVersion.epoch : Number.MAX_SAFE_INTEGER,
    };
  }

  public async waitForBlockProcessed(blockRoot: Uint8Array): Promise<void> {
    await new Promise((resolve) => {
      this.on("processedBlock", (signedBlock) => {
        const root = this.config.types.BeaconBlock.hashTreeRoot(signedBlock.message);
        if (this.config.types.Root.equals(root, blockRoot)) {
          resolve();
        }
      });
    });
  }

  /**
   * Restore state cache and forkchoice from last finalized state.
   */
  private async restoreHeadState(lastKnownState: TreeBacked<BeaconState>): Promise<void> {
    const finalizedCheckpoint = lastKnownState.finalizedCheckpoint;
    const finalizedEpoch = finalizedCheckpoint.epoch;
    const finalizedRoot = finalizedCheckpoint.root;
    this.logger.info(`Found last known finalized state at epoch #${finalizedEpoch} root ${toHexString(finalizedRoot)}`);
    this.logger.profile("restoreHeadState");
    this.db.stateCache.add(lastKnownState);
    // the block respective to finalized epoch is still in block db
    const allBlocks = await this.db.block.values();
    if (!allBlocks || allBlocks.length === 0) {
      return;
    }
    const sortedBlocks = sortBlocks(allBlocks);
    const firstBlock = allBlocks[0];
    const lastBlock = allBlocks[allBlocks.length - 1];
    let firstSlot = firstBlock.message.slot;
    let lastSlot = lastBlock.message.slot;
    this.logger.info(`Found ${allBlocks.length} nonfinalized blocks in database from slot ${firstSlot} to ${lastSlot}`);
    // initially we initialize database with genesis block
    if (allBlocks.length === 1) {
      // start from scratch
      const blockHash = this.config.types.BeaconBlock.hashTreeRoot(firstBlock.message);
      if (this.config.types.Root.equals(blockHash, this.forkChoice.headBlockRoot())) {
        this.logger.info("Chain is up to date, no need to restore");
        return;
      }
    }
    const isCheckpointNotGenesis = lastKnownState.slot > GENESIS_SLOT;
    const stateRoot = this.config.types.BeaconState.hashTreeRoot(lastKnownState);
    const finalizedBlock = sortedBlocks.find(block => {
      return (block.message.slot === lastKnownState.slot) &&
      // at genesis the genesis block's state root is not equal to genesis state root
      (isCheckpointNotGenesis? this.config.types.Root.equals(block.message.stateRoot, stateRoot) : true);
    });
    if (!finalizedBlock) {
      throw new Error(`Cannot find block for finalized state at slot ${lastKnownState.slot}`);
    } else {
      this.logger.info(`Found finalized block at slot ${finalizedBlock.message.slot},
        root=${toHexString(this.config.types.BeaconBlock.hashTreeRoot(finalizedBlock.message))}`);
    }
    // init forkchoice
    const blockCheckpoint: Checkpoint = {
      root: this.config.types.BeaconBlock.hashTreeRoot(finalizedBlock.message),
      epoch: computeEpochAtSlot(this.config, finalizedBlock.message.slot)
    };
    this.forkChoice.addBlock({
      slot: finalizedBlock.message.slot,
      blockRoot: this.config.types.BeaconBlock.hashTreeRoot(finalizedBlock.message),
      stateRoot: finalizedBlock.message.stateRoot.valueOf() as Uint8Array,
      parentRoot: finalizedBlock.message.parentRoot.valueOf() as Uint8Array,
      justifiedCheckpoint: (isCheckpointNotGenesis)? lastKnownState.currentJustifiedCheckpoint : blockCheckpoint,
      finalizedCheckpoint: (isCheckpointNotGenesis)? lastKnownState.finalizedCheckpoint : blockCheckpoint
    });
    // init state cache
    this.db.stateCache.add(lastKnownState);
    // no need to process the finalized block
    const processedBlocks = sortedBlocks.filter((block) => block.message.slot > finalizedBlock.message.slot);
    if (!processedBlocks.length) {
      this.logger.info("No need to process blocks");
      return;
    }
    firstSlot = processedBlocks[0].message.slot;
    lastSlot = processedBlocks[processedBlocks.length - 1].message.slot;
    this.logger.info(`Start processing from slot ${firstSlot} to ${lastSlot} to rebuild state cache and forkchoice`);
    await Promise.all([
      ...processedBlocks.map(block => this.receiveBlock(block, true, true)),
      this.waitForBlockProcessed(this.config.types.BeaconBlock.hashTreeRoot(lastBlock.message))
    ]);
    this.logger.important(`Finish restoring chain head from ${allBlocks.length} blocks`);
    this.logger.profile("restoreHeadState");
  }

  private async handleForkDigestChanged(): Promise<void> {
    this._currentForkDigest = await this.getCurrentForkDigest();
    this.emit("forkDigest", this._currentForkDigest);
  }

  private async getCurrentForkDigest(): Promise<ForkDigest> {
    const state = await this.getHeadState();
    return computeForkDigest(this.config, state.fork.currentVersion, state.genesisValidatorsRoot);
  }

  // If we don't have a state yet, we have to wait for genesis state
  private async waitForState(): Promise<TreeBacked<BeaconState>> {
    let state: TreeBacked<BeaconState> = await this.db.stateArchive.lastValue();
    if (!state) {
      this.logger.info("Chain not started, listening for genesis block");
      state = await new Promise((resolve) => {
        const genesisListener = async (timestamp: number, eth1Data: Eth1Data): Promise<void> => {
          const state = await this.checkGenesis(timestamp, eth1Data);
          if (state) {
            this.eth1.removeListener("eth1Data", genesisListener);
            resolve(state);
          }
        };
        this.eth1.on("eth1Data", genesisListener);
      });
    }
    // set metrics based on beacon state
    this.metrics.currentSlot.set(state.slot);
    this.metrics.previousJustifiedEpoch.set(state.previousJustifiedCheckpoint.epoch);
    this.metrics.currentJustifiedEpoch.set(state.currentJustifiedCheckpoint.epoch);
    this.metrics.currentFinalizedEpoch.set(state.finalizedCheckpoint.epoch);
    return state;
  }

  /**
   * Create a candidate BeaconState from the deposits at a certain time and eth1 state
   *
   * Returns the BeaconState if it is valid else null
   */
  private checkGenesis = async (timestamp: number, eth1Data: Eth1Data): Promise<TreeBacked<BeaconState> | null> => {
    const blockHashHex = toHexString(eth1Data.blockHash);
    this.logger.info(`Checking if block ${blockHashHex} will form valid genesis state`);
    const depositDatas = await this.db.depositData.values({lt: eth1Data.depositCount});
    const depositDataRoots = await this.db.depositDataRoot.values({lt: eth1Data.depositCount});
    this.logger.info(`Found ${depositDatas.length} deposits`);
    const depositDataRootList = this.config.types.DepositDataRootList.tree.defaultValue();
    const tree = depositDataRootList.tree();

    const genesisState = initializeBeaconStateFromEth1(
      this.config,
      eth1Data.blockHash,
      timestamp,
      depositDatas.map((data, index) => {
        depositDataRootList.push(depositDataRoots[index]);
        return {
          proof: tree.getSingleProof(depositDataRootList.gindexOfProperty(index)),
          data,
        };
      })
    );
    if (!isValidGenesisState(this.config, genesisState)) {
      this.logger.info(`Eth1 block ${blockHashHex} is NOT forming valid genesis state`);
      return null;
    }
    this.logger.info(`Initializing beacon chain with eth1 block ${blockHashHex}`);
    await this.initializeBeaconChain(genesisState as TreeBacked<BeaconState>);
    this.logger.info(`Genesis state is ready with ${genesisState.validators.length} validators`);
    return genesisState;
  };

}
