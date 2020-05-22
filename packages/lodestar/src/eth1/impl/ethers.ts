/**
 * @module eth1
 */

import {EventEmitter} from "events";
import {Contract, ethers} from "ethers";
import {Block} from "ethers/providers";
import {fromHexString} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from  "@chainsafe/lodestar-utils/lib/logger";
import {isValidAddress} from "../../util/address";
import {RetryProvider} from "./retryProvider";
import {IEth1Options} from "../options";
import {Eth1EventEmitter, IEth1Notifier, IDepositEvent} from "../interface";
import pushable, {Pushable} from "it-pushable";
import pipe from "it-pipe";
import {sleep} from "../../util/sleep";

export interface IEthersEth1Options extends IEth1Options {
  contract?: Contract;
}

export interface IEthersEth1Modules {
  config: IBeaconConfig;
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
  private logger: ILogger;

  private started: boolean;
  private lastProcessedEth1BlockNumber: number;
  private eth1DataSource: Pushable<IDepositEvent[]>;
  private targetBlockSource: Pushable<number>;
  private processingBlock: boolean;

  public constructor(opts: IEthersEth1Options, {config, logger}: IEthersEth1Modules) {
    super();
    this.opts = opts;
    this.config = config;
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
    await this.initialize();
  }

  /**
   * Main methods to be called either to build genesis state or to save data to propose block later.
   * @param isScanEth1ForGenesis
   * @param fromBlock
   */
  public async getDepositEventsByBlock(
    isScanEth1ForGenesis: boolean, fromBlock?: number): Promise<Pushable<IDepositEvent[]>> {
    if (!isScanEth1ForGenesis && !this.opts.enabled) {
      this.logger.warn(`eth1 is disabled so can't get deposit event, fromBlock=${fromBlock}`);
      return null;
    }
    // if we try to form deposit, allow to scan deposit events even eth1 is disabled
    if (!this.opts.enabled) {
      await this.initialize();
    }
    this.lastProcessedEth1BlockNumber = fromBlock || this.opts.depositContract.deployedAt - 1;
    this.logger.info("eth1: Get deposit events by block from block " + this.lastProcessedEth1BlockNumber);
    this.eth1DataSource = pushable<IDepositEvent[]>();
    this.targetBlockSource = pushable<number>();
    // should not wait
    this.doGetDepositEventsByBlock();
    return this.eth1DataSource;
  }

  /**
   * Called by genesis builder to inform that we found genesis state.
   * Should stop pushing deposit events to genesis builder.
   */
  public async foundGenesis(): Promise<void> {
    this.eth1DataSource.end();
    this.eth1DataSource = undefined;
    this.targetBlockSource.end();
    this.targetBlockSource = undefined;
    // we'll start listening for new block after chain starts
    this.provider.removeAllListeners("block");
    while (this.processingBlock) {
      await sleep(5);
    }
    this.logger.info("eth1 foundGenesis: stopped scanning eth1 data");
  }

  public async stop(): Promise<void> {
    if (!this.started) {
      this.logger.verbose("Eth1 notifier already stopped");
      return;
    }
    if (this.eth1DataSource) {
      this.eth1DataSource.end();
      this.eth1DataSource = undefined;
    }
    if (this.targetBlockSource) {
      this.targetBlockSource.end();
      this.targetBlockSource = undefined;
    }
    this.provider.removeAllListeners("block");
    this.started = false;
    while (this.processingBlock) {
      await sleep(5);
    }
    this.logger.info("eth1: stopped scanning eth1 data");
  }

  public async onNewEth1Block(blockNumber: number): Promise<void> {
    const followBlockNumber = blockNumber - this.config.params.ETH1_FOLLOW_DISTANCE;
    if (followBlockNumber > 0) {
      this.targetBlockSource.push(followBlockNumber);
    }
  }

  public async getDepositEvents(fromBlockTag: string | number, toBlockTag?: string | number): Promise<IDepositEvent[]> {
    return (await this.provider.getLogs({
      fromBlock: fromBlockTag,
      toBlock: toBlockTag,
      address: this.contract.address,
      topics: [this.contract.interface.events.DepositEvent.topic],
    })).map((log) => {
      const blockNumber = log.blockNumber;
      return this.parseDepositEvent(this.contract.interface.parseLog(log).values, blockNumber);
    });
  }

  public async getBlock(blockTag: string | number): Promise<Block> {
    try {
      return this.provider.getBlock(blockTag, false);
    } catch (e) {
      this.logger.warn("eth1: Failed to get eth1 block " + blockTag + ". Error: " + e.message);
      return null;
    }
  }

  public async initContract(): Promise<void> {
    const address = this.opts.depositContract.address;
    const abi = this.opts.depositContract.abi;
    if (!(await this.contractExists(address))) {
      throw new Error(`eth1: There is no deposit contract at given address: ${address}`);
    }
    try {
      this.contract = new ethers.Contract(address, abi, this.provider);
    } catch (e) {
      throw new Error("eth1 deposit contract not found! Probably wrong eth1 rpc url");
    }
  }

  /**
   * This can be scanned for genesis, or scan until stop for proposing block.
   */
  private async doGetDepositEventsByBlock(): Promise<void> {
    const followBlockNumber = await this.provider.getBlockNumber() - this.config.params.ETH1_FOLLOW_DISTANCE;
    this.logger.info(
      `eth1: Start scanning Eth1Data last block =${this.lastProcessedEth1BlockNumber}` +
      ` followBlockNumber=${followBlockNumber}`
    );
    await this.process(followBlockNumber);
    if (this.lastProcessedEth1BlockNumber === followBlockNumber) {
      // the previous pipe is done, need to start a new one
      this.process(undefined);
      this.provider.on("block", this.onNewEth1Block.bind(this));
    }
  }


  /**
   * Scan deposit events per every n (100 currently) blocks until inBlockNumber
   * If undefined inBlockNumber then this is a reusable pipe, process whenever we push to targetBlockSource.
   * If inBlockNumber exists, we close pipe after use.
   * @param inBlockNumber
   */
  private async process(inBlockNumber?: number): Promise<void> {
    if (inBlockNumber) {
      this.targetBlockSource.push(inBlockNumber);
    }
    pipe(this.targetBlockSource,
      async (source) => {
        for await(const targetBlockNumber of source) {
          if (targetBlockNumber <= this.lastProcessedEth1BlockNumber) {
            continue;
          }
          const blockNumber = Math.min(this.lastProcessedEth1BlockNumber + 100, targetBlockNumber);
          await this.getAndProcessDepositEvents(this.lastProcessedEth1BlockNumber + 1, blockNumber);
          if (!this.eth1DataSource || !this.targetBlockSource) {
            return;
          }
          if (this.lastProcessedEth1BlockNumber < targetBlockNumber) {
            this.targetBlockSource.push(targetBlockNumber);
          } else if (inBlockNumber) {
            // finish this pipe if this is a catchup until followup block
            return;
          }
          // keep this pipe open until we receive new eth1 block
        }
      }
    );
  }

  /**
   * Process blocks in bulk.
   * Must process blocks in order with no gaps.
   * @param fromBlockNbr
   * @param toBlockNbr
   */
  private async getAndProcessDepositEvents(fromBlockNbr: number, toBlockNbr: number): Promise<void> {
    if (toBlockNbr < fromBlockNbr) {
      return;
    }
    this.logger.verbose(`eth1: getting events from block ${fromBlockNbr} to ${toBlockNbr}`);
    try {
      this.processingBlock = true;
      const depositEvents  = await this.getDepositEvents(fromBlockNbr, toBlockNbr);
      this.logger.info(`eth1: Found ${depositEvents.length} deposit events from block ` +
        `${fromBlockNbr} to ${toBlockNbr}`);
      this.processingBlock = false;
      if (!this.eth1DataSource) {
        return;
      }
      if (depositEvents.length === 0) {
        this.lastProcessedEth1BlockNumber = toBlockNbr;
        this.logger.verbose("eth1: Set lastProcessedEth1BlockNumber to " + this.lastProcessedEth1BlockNumber);
        return;
      }
      // const lastBlockNumber = depositEvents[depositEvents.length - 1].blockNumber;
      // const firstBlockNumber = depositEvents[0].blockNumber;
      // for (let blockNumber = firstBlockNumber; blockNumber <= lastBlockNumber; blockNumber++) {
      //   const blockDepositEvents = depositEvents.filter(event => event.blockNumber === blockNumber);
      //   if (blockDepositEvents.length > 0) {
      //     this.logger.info(`eth1: Found ${blockDepositEvents.length} deposit events for block ${blockNumber}`);
      //     this.eth1DataSource.push(blockDepositEvents);
      //   }
      // }
      // consumers should group by block whenever it needs to
      this.eth1DataSource.push(depositEvents);
      this.lastProcessedEth1BlockNumber = toBlockNbr;
    } catch (ex) {
      this.logger.error(
        `eth1: Failed to process deposit events last eth1 block is ${this.lastProcessedEth1BlockNumber}` +
        `, err=${ex.message}`
      );
    }
  }

  private async initialize(): Promise<void> {
    if(!this.contract) {
      await this.initContract();
    }
    this.logger.info(
      `eth1: Started listening to eth1 provider ${this.opts.provider.url} on chain ${this.opts.provider.network}`
    );
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
  private parseDepositEvent(log: any, blockNumber: number): IDepositEvent {
    return {
      blockNumber,
      index: this.config.types.Number64.deserialize(fromHexString(log.index)),
      pubkey: fromHexString(log.pubkey),
      withdrawalCredentials: fromHexString(log.withdrawal_credentials),
      amount: this.config.types.Gwei.deserialize(fromHexString(log.amount)),
      signature: fromHexString(log.signature),
    };
  }
}
