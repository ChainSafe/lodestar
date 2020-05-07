/**
 * @module eth1
 */

import {EventEmitter} from "events";
import {Contract, ethers} from "ethers";
import {Block} from "ethers/providers";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from  "@chainsafe/lodestar-utils/lib/logger";

import {isValidAddress} from "../../util/address";
import {sleep} from "../../util/sleep";
import {IBeaconDb} from "../../db";
import {RetryProvider} from "./retryProvider";
import {IEth1Options} from "../options";
import {Eth1EventEmitter, IEth1Notifier, IDepositEvent} from "../interface";

export interface IEthersEth1Options extends IEth1Options {
  contract?: Contract;
}

export interface IEthersEth1Modules {
  config: IBeaconConfig;
  db: IBeaconDb;
  logger: ILogger;
}

const ETH1_BLOCK_RETRY = 3;

/**
 * The EthersEth1Notifier watches the eth1 chain using ethers.js
 *
 * It proceses eth1 blocks, starting from block number `depositContract.deployedAt`, maintaining a follow distance.
 * It stores deposit events and eth1 data in a IBeaconDb resumes processing from the last stored eth1 data
 */
export class EthersEth1Notifier extends (EventEmitter as { new(): Eth1EventEmitter }) implements IEth1Notifier {

  private opts: IEthersEth1Options;

  private provider: ethers.providers.BaseProvider;
  private contract: ethers.Contract;

  private config: IBeaconConfig;
  private db: IBeaconDb;
  private logger: ILogger;

  private started: boolean;
  private processingBlock: boolean;
  private lastProcessedEth1BlockNumber: number;
  private lastProcessedDepositIndex: number;

  public constructor(opts: IEthersEth1Options, {config, db, logger}: IEthersEth1Modules) {
    super();
    this.opts = opts;
    this.config = config;
    this.db = db;
    this.logger = logger;
    if(this.opts.providerInstance) {
      this.provider = this.opts.providerInstance;
    } else {
      this.provider = new RetryProvider(
        ETH1_BLOCK_RETRY,
        this.opts.provider.url,
        this.opts.provider.network
      );
    }
    this.contract = opts.contract;
  }

  public async start(): Promise<void> {
    if (!this.opts.enabled) {
      this.logger.verbose("Eth1 notifier is disabled" );
      return;
    }
    if (this.started) {
      this.logger.verbose("Eth1 notifier already started" );
      return;
    }
    this.started = true;
    if(!this.contract) {
      await this.initContract();
    }
    const lastProcessedBlockTag = await this.getLastProcessedBlockTag();
    this.lastProcessedEth1BlockNumber = (await this.getBlock(lastProcessedBlockTag)).number;
    this.lastProcessedDepositIndex = await this.getLastProcessedDepositIndex();
    this.logger.info(
      `Started listening to eth1 provider ${this.opts.provider.url} on chain ${this.opts.provider.network}`
    );
    this.logger.verbose(
      `Last processed block number: ${this.lastProcessedEth1BlockNumber}, ` +
      `last processed deposit index: ${this.lastProcessedDepositIndex}`
    );
    const headBlockNumber = await this.provider.getBlockNumber();
    // process historical unprocessed blocks up to curent head
    // then start listening for incoming blocks
    this.onNewEth1Block(headBlockNumber).then(() => {
      this.provider.on("block", this.onNewEth1Block.bind(this));
    });
  }

  public async stop(): Promise<void> {
    if (!this.started) {
      this.logger.verbose("Eth1 notifier already stopped");
      return;
    }
    this.started = false;
    this.provider.removeAllListeners("block");
    while (this.processingBlock) {
      await sleep(5);
    }
  }

  public async getLastProcessedBlockTag(): Promise<string | number> {
    const lastEth1Data = await this.db.eth1Data.lastValue();
    return lastEth1Data ? toHexString(lastEth1Data.blockHash) : this.opts.depositContract.deployedAt;
  }
  public async getLastProcessedDepositIndex(): Promise<number> {
    const lastStoredIndex = await this.db.depositDataRoot.lastKey();
    return lastStoredIndex === null ? -1 : lastStoredIndex;
  }

  public async onNewEth1Block(blockNumber: number): Promise<void> {
    const followBlockNumber = blockNumber - this.config.params.ETH1_FOLLOW_DISTANCE;
    if (followBlockNumber > 0 && followBlockNumber > this.lastProcessedEth1BlockNumber) {
      await this.processBlocks(followBlockNumber);
    }
  }

  public async processBlocks(toNumber: number): Promise<void> {
    let blockNumber = this.lastProcessedEth1BlockNumber + 1;
    while (blockNumber <= toNumber && await this.processBlock(blockNumber)) {
      blockNumber++;
    }
  }

  /**
   * Process an eth1 block for DepositEvents and Eth1Data
   *
   * Must process blocks in order with no gaps
   *
   * Returns true if processing was successful
   */
  public async processBlock(blockNumber: number): Promise<boolean> {
    if (!this.started) {
      this.logger.verbose("Eth1 notifier must be started to process a block");
      return false;
    }
    this.processingBlock = true;
    this.logger.verbose(`Processing eth1 block ${blockNumber}`);
    if (blockNumber !== this.lastProcessedEth1BlockNumber + 1) {
      this.logger.verbose(
        `eth1 block out of order. expected: ${this.lastProcessedEth1BlockNumber + 1} actual: ${blockNumber}`
      );
      this.processingBlock = false;
      return false;
    }
    const block = await this.getBlock(blockNumber);
    if (!block) {
      this.logger.verbose(`eth1 block ${blockNumber} not found`);
      this.processingBlock = false;
      return false;
    }
    // get results
    const depositEvents  = await this.getDepositEvents(blockNumber);
    if (depositEvents.length) {
      this.lastProcessedDepositIndex = depositEvents[depositEvents.length - 1].index;
      this.logger.verbose(
        `${depositEvents.length} deposits found, latest depositIndex: ${this.lastProcessedDepositIndex}`
      );
    }
    // update state
    await Promise.all([
      // op pool depositData
      this.db.depositData.batchPut(depositEvents.map((depositEvent) => ({
        key: depositEvent.index,
        value: depositEvent,
      }))),
      // deposit data roots
      this.db.depositDataRoot.batchPut(depositEvents.map((depositEvent) => ({
        key: depositEvent.index,
        value: this.config.types.DepositData.hashTreeRoot(depositEvent),
      }))),
    ]);
    const depositTree = await this.db.depositDataRoot.getTreeBacked(this.lastProcessedDepositIndex);
    const eth1Data = {
      blockHash: fromHexString(block.hash),
      depositRoot: depositTree.tree().root,
      depositCount: this.lastProcessedDepositIndex + 1,
    };
    // eth1 data
    await this.db.eth1Data.put(block.timestamp, eth1Data);
    this.lastProcessedEth1BlockNumber++;
    // emit events
    depositEvents.forEach((depositEvent) => {
      this.emit("deposit", depositEvent.index, depositEvent);
    });
    this.emit("eth1Data", block.timestamp, eth1Data);
    this.processingBlock = false;
    return true;
  }

  public async getDepositEvents(blockTag: string | number): Promise<IDepositEvent[]> {
    return (await this.provider.getLogs({
      fromBlock: blockTag,
      toBlock: blockTag,
      address: this.contract.address,
      topics: [this.contract.interface.events.DepositEvent.topic],
    })).map((log) => {
      return this.parseDepositEvent(this.contract.interface.parseLog(log).values);
    });
  }

  public async getBlock(blockTag: string | number): Promise<Block> {
    return this.provider.getBlock(blockTag, false);
  }

  public async initContract(): Promise<void> {
    const address = this.opts.depositContract.address;
    const abi = this.opts.depositContract.abi;
    if (!(await this.contractExists(address))) {
      throw new Error(`There is no deposit contract at given address: ${address}`);
    }
    try {
      this.contract = new ethers.Contract(address, abi, this.provider);
    } catch (e) {
      throw new Error("Eth1 deposit contract not found! Probably wrong eth1 rpc url");
    }
  }

  private async contractExists(address: string): Promise<boolean> {
    if (!isValidAddress(address)) return false;
    const code = await this.provider.getCode(address);
    return !(!code || code === "0x");
  }
  /**
   * Parse DepositEvent log
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseDepositEvent(log: any): IDepositEvent {
    return {
      index: this.config.types.Number64.deserialize(fromHexString(log.index)),
      pubkey: fromHexString(log.pubkey),
      withdrawalCredentials: fromHexString(log.withdrawal_credentials),
      amount: this.config.types.Gwei.deserialize(fromHexString(log.amount)),
      signature: fromHexString(log.signature),
    };
  }
}
