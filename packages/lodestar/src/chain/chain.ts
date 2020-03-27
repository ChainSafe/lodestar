/**
 * @module chain
 */

import {EventEmitter} from "events";
import {fromHexString, List, toHexString, TreeBacked} from "@chainsafe/ssz";
import {Attestation, BeaconState, Root, SignedBeaconBlock, Uint16, Uint64,} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {EMPTY_SIGNATURE, GENESIS_SLOT} from "../constants";
import {IBeaconDb} from "../db";
import {IEth1Notifier} from "../eth1";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IBeaconMetrics} from "../metrics";
import {getEmptyBlock, initializeBeaconStateFromEth1, isValidGenesisState} from "./genesis/genesis";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {ILMDGHOST, StatefulDagLMDGHOST} from "./forkChoice";

import {ChainEventEmitter, IAttestationProcessor, IBeaconChain} from "./interface";
import {IChainOptions} from "./options";
import {OpPool} from "../opPool";
import {Block} from "ethers/providers";
import {AttestationProcessor} from "./attestation";
import {IBeaconClock} from "./clock/interface";
import {LocalClock} from "./clock/local/LocalClock";
import {BlockProcessor} from "./blocks";

export interface IBeaconChainModules {
  config: IBeaconConfig;
  opPool: OpPool;
  db: IBeaconDb;
  eth1: IEth1Notifier;
  logger: ILogger;
  metrics: IBeaconMetrics;
}

export interface IBlockProcessJob {
  signedBlock: SignedBeaconBlock;
  trusted: boolean;
}

export class BeaconChain extends (EventEmitter as { new(): ChainEventEmitter }) implements IBeaconChain {

  public readonly chain: string;
  public readonly forkChoice: ILMDGHOST;
  public readonly chainId: Uint16;
  public readonly networkId: Uint64;
  public clock: IBeaconClock;

  private readonly config: IBeaconConfig;
  private readonly db: IBeaconDb;
  private readonly opPool: OpPool;
  private readonly eth1: IEth1Notifier;
  private readonly logger: ILogger;
  private readonly metrics: IBeaconMetrics;
  private readonly opts: IChainOptions;
  private blockProcessor: BlockProcessor;
  private attestationProcessor: IAttestationProcessor;

  public constructor(opts: IChainOptions, {config, db, eth1, opPool, logger, metrics}: IBeaconChainModules) {
    super();
    this.opts = opts;
    this.chain = opts.name;
    this.config = config;
    this.db = db;
    this.eth1 = eth1;
    this.opPool = opPool;
    this.logger = logger;
    this.metrics = metrics;
    this.forkChoice = new StatefulDagLMDGHOST(config);
    this.chainId = 0; // TODO make this real
    this.networkId = 0n; // TODO make this real
    this.blockProcessor = new BlockProcessor(config, logger, db, this.forkChoice, metrics, this);
    this.attestationProcessor = new AttestationProcessor(this, this.forkChoice, {config, db, logger});
  }

  public isInitialized(): boolean {
    throw new Error("Method not implemented.");
  }

  public async start(): Promise<void> {
    const state = await this.db.state.getLatest();
    this.forkChoice.start(state.genesisTime);
    // if state doesn't exist in the db, the chain maybe hasn't started
    if (!state) {
      // check every block if genesis
      this.logger.info("Chain not started, listening for genesis block");
      this.eth1.on("block", this.checkGenesis);
    }
    this.logger.info("Chain started, waiting blocks and attestations");
    this.clock = new LocalClock(this.config, state.genesisTime);
    await this.clock.start();
    await this.blockProcessor.start();
  }

  public async stop(): Promise<void> {
    await this.forkChoice.stop();
    await this.clock.stop();
    await this.blockProcessor.stop();
    this.eth1.removeListener("block", this.checkGenesis);
  }

  public async receiveAttestation(attestation: Attestation): Promise<void> {
    return this.attestationProcessor.receiveAttestation(attestation);
  }

  public async receiveBlock(signedBlock: SignedBeaconBlock, trusted = false): Promise<void> {
    this.blockProcessor.receiveBlock(signedBlock, trusted);
  }

  public async initializeBeaconChain(
    genesisState: BeaconState,
    depositDataRootList: TreeBacked<List<Root>>
  ): Promise<void> {
    const genesisBlock = getEmptyBlock();
    const stateRoot = this.config.types.BeaconState.hashTreeRoot(genesisState);
    genesisBlock.stateRoot = stateRoot;
    const blockRoot = this.config.types.BeaconBlock.hashTreeRoot(genesisBlock);
    this.logger.info(`Initializing beacon chain with state root ${toHexString(stateRoot)}`
            + ` and genesis block root ${toHexString(blockRoot)}`
    );
    // Determine whether a genesis state already in
    // the database matches what we were provided
    const storedGenesisBlock = await this.db.block.getBlockBySlot(GENESIS_SLOT);
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
      this.db.depositDataRootList.set(genesisState.eth1DepositIndex, depositDataRootList)
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
  

  private checkGenesis = async (eth1Block: Block): Promise<void> => {
    this.logger.info(`Checking if block ${eth1Block.hash} will form valid genesis state`);
    const depositDatas = await this.opPool.depositData.getAll();
    const depositDataRootList = this.config.types.DepositDataRootList.tree.defaultValue();
    depositDataRootList.push(...depositDatas.map(this.config.types.DepositData.hashTreeRoot));
    const tree = depositDataRootList.tree();

    const genesisState = initializeBeaconStateFromEth1(
      this.config,
      fromHexString(eth1Block.hash),
      eth1Block.timestamp,
      depositDatas.map((data, index) => {
        return {
          proof: tree.getSingleProof(depositDataRootList.gindexOfProperty(index)),
          data,
        };
      })
    );
    if (!isValidGenesisState(this.config, genesisState)) {
      this.logger.info(`Eth1 block ${eth1Block.hash} is NOT forming valid genesis state`);
      return;
    }
    this.logger.info(`Initializing beacon chain with eth1 block ${eth1Block.hash}`);
    await this.initializeBeaconChain(genesisState, depositDataRootList);
  };

}
