/**
 * @module eth1
 */

import {Contract, ethers} from "ethers";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from  "@chainsafe/lodestar-utils/lib/logger";

import {isValidAddress} from "../../util/address";
import {IBeaconDb} from "../../db";
import {RetryProvider} from "./retryProvider";
import {IEth1Options} from "../options";
import {IEth1Notifier, IDepositEvent, Eth1Block, Eth1EventsBlock} from "../interface";
import {groupDepositEventsByBlock} from "./util";
import pushable, {Pushable} from "it-pushable";
import {calculateStateTime} from "../../chain/genesis/util";
import {Eth1Data} from "@chainsafe/lodestar-types";

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
export class EthersEth1Notifier implements IEth1Notifier {

  private opts: IEthersEth1Options;

  private provider: ethers.providers.Provider;
  private contract: ethers.Contract;

  private config: IBeaconConfig;
  private db: IBeaconDb;
  private logger: ILogger;

  private startedProcessEth1: boolean;
  private lastProcessedEth1BlockNumber: number;
  private lastDepositCount: number;
  /**
   * Pregenesis block number to check remaining time/block to form genesis.
   * This helps avoid calling too many unnecessary getBlock() calls before genesis.
   */
  private preGenesisCheckpoint: number;
  private eth1Source: Pushable<Eth1EventsBlock>;

  public constructor(opts: IEthersEth1Options, {config, db, logger}: IEthersEth1Modules) {
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
    this.preGenesisCheckpoint = undefined;
  }

  /**
   * Chain calls this after found genesis.
   */
  public async start(): Promise<void> {
    if (!this.opts.enabled) {
      this.logger.verbose("Eth1 notifier is disabled, no need to process eth1 for proposing data");
      return;
    }
    // no need await
    this.startProcessEth1Blocks();
  }

  public async stop(): Promise<void> {
    this.provider.removeAllListeners("block");
    // stop processing eth1
    this.startedProcessEth1 = false;
    this.logger.verbose("Eth1 notifier stopped");
  }

  /**
   * Genesis builder calls this at pregenesis time.
   */
  public async getEth1BlockAndDepositEventsSource(): Promise<Pushable<Eth1EventsBlock>> {
    if (!this.opts.enabled) {
      this.logger.info("Eth1 notifier is disabled but starting it to build genesis state");
    }
    this.eth1Source = pushable<Eth1EventsBlock>();
    // no need await
    this.startProcessEth1Blocks();
    return this.eth1Source;
  }

  /**
   * Unsubscribe to eth1 events + blocks
   */
  public async endEth1BlockAndDepositEventsSource(): Promise<void> {
    if (this.eth1Source) {
      this.eth1Source.end();
      this.eth1Source = null;
    }
    if (!this.opts.enabled) {
      this.logger.info("Genesis builder is done and eth1 disabled, stopping eth1");
      await this.stop();
    }
    this.logger.info("Unsubscribed eth1 blocks & depoosit events");
  }

  public async getLastProcessedBlockTag(lastEth1Data: Eth1Data): Promise<string | number> {
    return lastEth1Data? toHexString(lastEth1Data.blockHash) : this.opts.depositContract.deployedAt;
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

  /**
   * Process blocks from lastProcessedEth1BlockNumber + 1 until toNumber.
   * @param toNumber
   */
  public async processBlocks(toNumber: number): Promise<void> {
    this.logger.info(`Processing eth1 blocks from ${this.lastProcessedEth1BlockNumber + 1} to ${toNumber}`);
    let rangeBlockNumber = this.lastProcessedEth1BlockNumber;
    while (rangeBlockNumber < toNumber && this.startedProcessEth1) {
      const endRangeBlockNumber = Math.min(this.lastProcessedEth1BlockNumber + 1000, toNumber);
      let rangeDepositEvents;
      try {
        rangeDepositEvents = await this.getDepositEvents(this.lastProcessedEth1BlockNumber + 1, endRangeBlockNumber);
        this.logger.verbose(`Found ${rangeDepositEvents.length} events from block ` +
          `${this.lastProcessedEth1BlockNumber + 1} to ${endRangeBlockNumber}`);
      } catch (ex) {
        this.logger.warn(`eth1: failed to get deposit events from ${this.lastProcessedEth1BlockNumber + 1}`
          + ` to ${endRangeBlockNumber}`);
        continue;
      }
      let success = true;
      for (const [blockNumber, blockDepositEvents] of
        groupDepositEventsByBlock(rangeDepositEvents, this.lastProcessedEth1BlockNumber + 1, endRangeBlockNumber)) {
        if (!await this.processDepositEvents(blockNumber, blockDepositEvents)) {
          this.logger.warn(`Failed to process events for block ${blockNumber}`);
          success = false;
          break;// break for, should continue while
        } else {
          this.lastProcessedEth1BlockNumber = blockNumber;
        }
      }
      if (success) {
        rangeBlockNumber = endRangeBlockNumber;
        // This is to make sure we update lastProcessedEth1BlockNumber even 0 events found
        this.lastProcessedEth1BlockNumber = endRangeBlockNumber;
      }
    }
    this.logger.info(`Done procesing up to block ${toNumber}`);
  }

  /**
   * Process an eth1 block for DepositEvents and Eth1Data
   *
   * Must process blocks in order with no gaps
   *
   * Returns true if processing was successful
   */
  public async processDepositEvents(blockNumber: number, blockDepositEvents: IDepositEvent[]): Promise<boolean> {
    if (!this.startedProcessEth1) {
      this.logger.verbose("Eth1 notifier must be started to process a block");
      return false;
    }
    // update state
    await Promise.all([
      // op pool depositData
      this.db.depositData.batchPut(blockDepositEvents.map((depositEvent) => ({
        key: depositEvent.index,
        value: depositEvent,
      }))),
      // deposit data roots
      this.db.depositDataRoot.batchPut(blockDepositEvents.map((depositEvent) => ({
        key: depositEvent.index,
        value: this.config.types.DepositData.hashTreeRoot(depositEvent),
      }))),
    ]);
    if (blockDepositEvents.length > 0) {
      this.logger.verbose(`Processing ${blockDepositEvents.length} deposit events of eth1 block ${blockNumber}`);
      this.lastDepositCount = blockDepositEvents[blockDepositEvents.length - 1].index + 1;
    }
    const shouldGetBlock = this.lastDepositCount >= this.config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT &&
      this.passCheckpoint(blockNumber);
    // preGenesis: avoid calling getBlock() frequently if we are too far away from genesis time
    // postGenesis: always call getBlock to store eth1Data
    if (shouldGetBlock) {
      const block = await this.getBlock(blockNumber);
      if (!block) {
        this.logger.verbose(`eth1 block ${blockNumber} not found`);
        return false;
      }
      const beforeGenesis = this.setCheckpoint(block);
      if (beforeGenesis) {
        this.eth1Source && blockDepositEvents.length > 0 && this.eth1Source.push({events: blockDepositEvents});
        return true;
      } else {
        // maybe no deposit events for this block, still need to push to form genesis
        this.eth1Source && this.eth1Source.push({events: blockDepositEvents, block});
        return await this.processEth1Data(block);
      }
    } else {
      this.eth1Source && blockDepositEvents.length > 0 && this.eth1Source.push({events: blockDepositEvents});
    }
    return true;
  }

  /**
   * Before genesis: return blockNumber >= checkpoint
   * After genesis: true
   */
  public passCheckpoint(blockNumber: number): boolean {
    return (!this.preGenesisCheckpoint || blockNumber >= this.preGenesisCheckpoint);
  }

  /**
   * Before genesis: set the next checkpoint from the current checkpoint.
   * Ideally it's 1024 blocks to genesis, then 512 -> 256 -> ... 2 -> 1 -> 0
   * @returns true of before genesis, false otherwise
   */
  public setCheckpoint(block: Eth1Block): boolean {
    const estimatedStateTime = calculateStateTime(this.config, block.timestamp);
    if (estimatedStateTime < this.config.params.MIN_GENESIS_TIME) {
      const numBlocksToGenesis = Math.floor(
        (this.config.params.MIN_GENESIS_TIME - estimatedStateTime) / this.config.params.SECONDS_PER_ETH1_BLOCK);
      if (numBlocksToGenesis <= 2) {
        this.logger.info(`At block ${block.number}, probably ${numBlocksToGenesis} blocks` +
          " to genesis time if there is enough validators");
        // if it's too close to genesis time then always getBlock()
        this.preGenesisCheckpoint = undefined;
      } else {
        this.preGenesisCheckpoint = block.number + Math.floor(numBlocksToGenesis / 2);
        this.logger.info(`Set checkpoint to ${this.preGenesisCheckpoint}`);
      }
      return true;
    } else {
      this.preGenesisCheckpoint = undefined;
      return false;
    }
  }

  /**
   * Process proposing data of eth1 block
   * @param blockNumber
   * @param blockDepositEvents
   * @returns true if success
   */
  public async processEth1Data(block: Eth1Block): Promise<boolean> {
    if (!this.startedProcessEth1) {
      this.logger.verbose("Eth1 notifier must be started to process a block");
      return false;
    }
    this.logger.verbose(`Processing proposing data of eth1 block ${block.number}`);
    const depositTree = await this.db.depositDataRoot.getTreeBacked(this.lastDepositCount - 1);
    const eth1Data = {
      blockHash: fromHexString(block.hash),
      depositRoot: depositTree.tree().root,
      depositCount: this.lastDepositCount,
    };
    // eth1 data
    await this.db.eth1Data.put(block.timestamp, eth1Data);
    this.lastProcessedEth1BlockNumber = block.number;
    return true;
  }

  public async getDepositEvents(fromBlockTag: string | number, toBLockTag?: string | number): Promise<IDepositEvent[]> {
    const filter = this.contract.filters.DepositEvent();
    const logs = await this.contract.queryFilter(filter, fromBlockTag, toBLockTag || fromBlockTag);
    return logs.map((log) => this.parseDepositEvent(log));
  }

  public async getBlock(blockTag: string | number): Promise<Eth1Block> {
    try {
      // without await we can't catch error
      return await this.provider.getBlock(blockTag);
    } catch (e) {
      this.logger.warn("Failed to get eth1 block " + blockTag + ". Error: " + e.message);
      return null;
    }
  }

  private async initContract(): Promise<void> {
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

  /**
   * This is triggered when building genesis or after chain gets started.
   */
  private async startProcessEth1Blocks(): Promise<void> {
    if (this.startedProcessEth1) {
      this.logger.info("Started processing eth1 blocks already");
      return;
    }
    this.startedProcessEth1 = true;
    if(!this.contract) {
      await this.initContract();
    }
    const lastEth1Data = await this.db.eth1Data.lastValue();
    const lastProcessedBlockTag = await this.getLastProcessedBlockTag(lastEth1Data);
    this.lastProcessedEth1BlockNumber = (await this.getBlock(lastProcessedBlockTag)).number;
    this.lastDepositCount = lastEth1Data? lastEth1Data.depositCount : 0;
    this.logger.info(
      `Started listening to eth1 provider ${this.opts.provider.url} on chain ${this.opts.provider.network}`
    );
    this.logger.verbose(
      `Last processed block number: ${this.lastProcessedEth1BlockNumber}`
    );
    const headBlockNumber = await this.provider.getBlockNumber();
    // process historical unprocessed blocks up to curent head
    // then start listening for incoming blocks
    await this.processBlocks(headBlockNumber - this.config.params.ETH1_FOLLOW_DISTANCE);
    if(this.startedProcessEth1) {
      this.provider.on("block", this.onNewEth1Block.bind(this));
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
  private parseDepositEvent(log: ethers.Event): IDepositEvent {
    const values = log.args;
    return {
      blockNumber: log.blockNumber,
      index: this.config.types.Number64.deserialize(fromHexString(values.index)),
      pubkey: fromHexString(values.pubkey),
      withdrawalCredentials: fromHexString(values.withdrawal_credentials),
      amount: this.config.types.Gwei.deserialize(fromHexString(values.amount)),
      signature: fromHexString(values.signature),
    };
  }
}
