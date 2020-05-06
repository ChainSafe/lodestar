/**
 * @module chain
 */

import {EventEmitter} from "events";
import {toHexString} from "@chainsafe/ssz";
import {
  Attestation,
  BeaconState,
  Checkpoint,
  ENRForkID,
  Eth1Data,
  ForkDigest,
  SignedBeaconBlock,
  Uint16,
  Uint64
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {computeEpochAtSlot, computeForkDigest} from "@chainsafe/lodestar-beacon-state-transition";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {intToBytes} from "@chainsafe/lodestar-utils";

import {EMPTY_SIGNATURE, GENESIS_SLOT} from "../constants";
import {IBeaconDb} from "../db";
import {IEth1Notifier} from "../eth1";
import {IBeaconMetrics} from "../metrics";
import {getEmptyBlock, initializeBeaconStateFromEth1, isValidGenesisState} from "./genesis/genesis";
import {ILMDGHOST, StatefulDagLMDGHOST} from "./forkChoice";

import {ChainEventEmitter, IAttestationProcessor, IBeaconChain} from "./interface";
import {IChainOptions} from "./options";
import {AttestationProcessor} from "./attestation";
import {IBeaconClock} from "./clock/interface";
import {LocalClock} from "./clock/local/LocalClock";
import {BlockProcessor} from "./blocks";

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
}

const MAX_VERSION = Buffer.from([255, 255, 255, 255]);
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
    this.forkChoice = forkChoice || new StatefulDagLMDGHOST(config);
    this.chainId = 0; // TODO make this real
    this.networkId = 0n; // TODO make this real
    this.attestationProcessor = new AttestationProcessor(this, this.forkChoice, {config, db, logger});
    this.blockProcessor = new BlockProcessor(
      config, logger, db, this.forkChoice, metrics, this, this.attestationProcessor
    );
  }

  public async getHeadState(): Promise<BeaconState|null> {
    return this.db.state.get(this.forkChoice.headStateRoot());
  }

  public async getHeadBlock(): Promise<SignedBeaconBlock|null> {
    return this.db.block.get(this.forkChoice.head());
  }

  public async getFinalizedCheckpoint(): Promise<Checkpoint> {
    const state = await this.getHeadState();
    return state.finalizedCheckpoint;
  }

  public async start(): Promise<void> {
    this.logger.verbose("Starting chain");
    // if we run from scratch, we want to wait for genesis state
    const state = await this.waitForState();
    this.logger.info("Chain started, waiting blocks and attestations");
    this.clock = new LocalClock(this.config, state.genesisTime);
    await this.clock.start();
    this.forkChoice.start(state.genesisTime, this.clock);
    await this.blockProcessor.start();
    this._currentForkDigest = await this.getCurrentForkDigest();
    this.on("forkDigestChanged", this.handleForkDigestChanged);
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

  public async receiveBlock(signedBlock: SignedBeaconBlock, trusted = false): Promise<void> {
    this.blockProcessor.receiveBlock(signedBlock, trusted);
  }

  public async initializeBeaconChain(genesisState: BeaconState): Promise<void> {
    const genesisBlock = getEmptyBlock();
    const stateRoot = this.config.types.BeaconState.hashTreeRoot(genesisState);
    genesisBlock.stateRoot = stateRoot;
    const blockRoot = this.config.types.BeaconBlock.hashTreeRoot(genesisBlock);
    this.logger.info(`Initializing beacon chain with state root ${toHexString(stateRoot)}`
            + ` and genesis block root ${toHexString(blockRoot)}`
    );
    // Determine whether a genesis state already in
    // the database matches what we were provided
    const storedGenesisBlock = await this.db.block.getBySlot(GENESIS_SLOT);
    if (storedGenesisBlock !== null &&
      !this.config.types.Root.equals(genesisBlock.stateRoot, storedGenesisBlock.message.stateRoot)) {
      throw new Error("A genesis state with different configuration was detected! Please clean the database.");
    }
    await Promise.all([
      this.db.storeChainHead({message: genesisBlock, signature: EMPTY_SIGNATURE}, genesisState),
      this.db.chain.setJustifiedBlockRoot(blockRoot),
      this.db.chain.setFinalizedBlockRoot(blockRoot),
      this.db.chain.setJustifiedStateRoot(stateRoot),
      this.db.chain.setFinalizedStateRoot(stateRoot),
    ]);
    const justifiedFinalizedCheckpoint = {
      root: blockRoot,
      epoch: computeEpochAtSlot(this.config, genesisBlock.slot)
    };
    this.forkChoice.addBlock({
      slot: genesisBlock.slot,
      blockRootBuf: blockRoot,
      stateRootBuf: stateRoot,
      parentRootBuf: Buffer.alloc(32),
      justifiedCheckpoint: justifiedFinalizedCheckpoint,
      finalizedCheckpoint: justifiedFinalizedCheckpoint,
    });
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

  private async handleForkDigestChanged(): Promise<void> {
    this._currentForkDigest = await this.getCurrentForkDigest();
    this.emit("forkDigest", this._currentForkDigest);
  }

  private async getCurrentForkDigest(): Promise<ForkDigest> {
    const state = await this.getHeadState();
    return computeForkDigest(this.config, state.fork.currentVersion, state.genesisValidatorsRoot);
  }

  // If we don't have a state yet, we have to wait for genesis state
  private async waitForState(): Promise<BeaconState> {
    let state: BeaconState;
    try {
      state = await this.db.state.getLatest();
    } catch (err) {
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
    return state;
  }

  /**
   * Create a candidate BeaconState from the deposits at a certain time and eth1 state
   *
   * Returns the BeaconState if it is valid else null
   */
  private checkGenesis = async (timestamp: number, eth1Data: Eth1Data): Promise<BeaconState | null> => {
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
    await this.initializeBeaconChain(genesisState);
    this.logger.info(`Genesis state is ready with ${genesisState.validators.length} validators`);
    return genesisState;
  };

}
