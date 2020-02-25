/**
 * @module eth1
 */

import {EventEmitter} from "events";
import {Contract, ethers} from "ethers";
import {Block, Log} from "ethers/providers";
import {fromHexString} from "@chainsafe/ssz";
import {Eth1Data, Number64, DepositData} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from  "@chainsafe/lodestar-utils/lib/logger";

import {Eth1EventEmitter, IEth1Notifier} from "../interface";
import {isValidAddress} from "../../util/address";
import {IEth1Options} from "../options";
import {getEth1Vote} from "./eth1Vote";

export interface IEthersEth1Options extends IEth1Options {
  contract?: Contract;
}

/**
 * Watch the Eth1.0 chain using Ethers
 */
export class EthersEth1Notifier extends (EventEmitter as { new(): Eth1EventEmitter }) implements IEth1Notifier {

  public getEth1Vote = getEth1Vote;

  private provider: ethers.providers.BaseProvider;

  private contract: ethers.Contract;

  private config: IBeaconConfig;

  private opts: IEthersEth1Options;

  private logger: ILogger;

  public constructor(opts: IEthersEth1Options, {config, logger}: {config: IBeaconConfig; logger: ILogger}) {
    // eslint-disable-next-line constructor-super
    super();
    this.config = config;
    this.opts = opts;
    this.logger = logger;
    if(this.opts.providerInstance) {
      this.provider = this.opts.providerInstance;
    } else {
      this.provider = new ethers.providers.JsonRpcProvider(
        this.opts.provider.url,
        this.opts.provider.network
      );
    }
    this.contract = opts.contract;
  }

  public async start(): Promise<void> {
    if(!this.contract) {
      await this.initContract();
    }
    this.logger.info("Fetching old deposits...");
    this.provider.on("block", this.processBlockHeadUpdate.bind(this));
    this.contract.on("DepositEvent", this.processDepositLog.bind(this));
    this.logger.info(
      `Started listening on eth1 events on chain ${(await this.provider.getNetwork()).chainId}`
    );


  }

  public async stop(): Promise<void> {
    this.provider.removeAllListeners("block");
    this.contract.removeAllListeners("DepositEvent");
  }

  public async processBlockHeadUpdate(blockNumber: number): Promise<void> {
    this.logger.verbose(`Received eth1 block ${blockNumber}`);
    const block = await this.provider.getBlock(blockNumber);
    this.emit("block", block);
  }

  public async processDepositLog(
    pubkey: string, withdrawalCredentials: string,
    amount: string,
    signature: string,
    merkleTreeIndex: string
  ): Promise<void> {
    try {
      const index = this.config.types.Number64.deserialize(fromHexString(merkleTreeIndex));
      const depositData = this.createDepositData(
        pubkey,
        withdrawalCredentials,
        amount,
        signature,
      );
      this.logger.info(
        `Received validator deposit event index=${index}`
      );
      this.emit("deposit", index, depositData);
    } catch (e) {
      this.logger.error(`Failed to process deposit log. Error: ${e.message}`);
    }
  }

  public async processPastDeposits(
    fromBlock: string | number  = this.opts.depositContract.deployedAt,
    toBlock?: string | number
  ): Promise<void> {
    const logs = await this.getContractPastLogs(
      [this.contract.interface.events.DepositEvent.topic],
      fromBlock,
      toBlock
    );
    const pastDeposits = logs.map((log) => {
      const logDescription = this.contract.interface.parseLog(log);
      return this.createDepositData(
        logDescription.values.pubkey,
        logDescription.values.withdrawalCredentials,
        logDescription.values.amount,
        logDescription.values.signature,
      );
    });
    pastDeposits.forEach((pastDeposit, index) => {
      this.emit("deposit", index, pastDeposit);
    });
  }

  public async getHead(): Promise<Block> {
    return this.getBlock("latest");
  }

  public async getBlock(blockHashOrBlockNumber: string | number): Promise<Block> {
    return this.provider.getBlock(blockHashOrBlockNumber, false);
  }

  public async depositRoot(block?: string | number): Promise<Uint8Array> {
    const depositRootHex = await this.contract.get_deposit_root({blockTag: block || "latest"});
    return fromHexString(depositRootHex);
  }

  public async depositCount(block?: string | number): Promise<number> {
    const depositCountHex = await this.contract.get_deposit_count({blockTag: block || "latest"});
    return Buffer.from(fromHexString(depositCountHex)).readUIntLE(0, 6);
  }

  public async getEth1Data(eth1Head: Block, distance: Number64): Promise<Eth1Data> {
    const requiredBlock = eth1Head.number - distance;
    const blockHash = (await this.getBlock(requiredBlock)).hash;
    const [depositCount, depositRoot] = await Promise.all([
      this.depositCount(blockHash),
      this.depositRoot(blockHash)
    ]);
    return {
      blockHash: fromHexString(blockHash),
      depositCount,
      depositRoot
    };
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

  private async contractExists(address: string): Promise<boolean> {
    if (!isValidAddress(address)) return false;
    const code = await this.provider.getCode(address);
    return !(!code || code === "0x");
  }

  private async getContractPastLogs(
    topics: string[],
    fromBlock: Number64 | string = this.opts.depositContract.deployedAt,
    toBlock: Number64 | string | null = null
  ): Promise<Log[]> {
    const filter = {
      fromBlock,
      toBlock,
      address: this.contract.address,
      topics
    };
    return await this.provider.getLogs(filter);
  }

  /**
   * Parse deposit log elements to a [[DepositData]]
   */
  private createDepositData(
    pubkey: string,
    withdrawalCredentials: string,
    amount: string,
    signature: string,
  ): DepositData {
    return {
      pubkey: fromHexString(pubkey),
      withdrawalCredentials: fromHexString(withdrawalCredentials),
      amount: this.config.types.Gwei.deserialize(fromHexString(amount)),
      signature: fromHexString(signature),
    };
  }
}
