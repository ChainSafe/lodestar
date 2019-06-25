/**
 * @module eth1
 */

import {EventEmitter} from "events";
import {Contract, ethers} from "ethers";
import {deserialize} from "@chainsafe/ssz";

import {bytes32, Deposit, Eth1Data, number64, Gwei} from "../../types";

import {IEth1Notifier, IEth1Options} from "../interface";
import {isValidAddress} from "../../util/address";
import {BeaconDB} from "../../db";
import {Block, Log} from "ethers/providers";
import {DEPOSIT_CONTRACT_TREE_DEPTH} from "../../constants/minimal";
import {ILogger} from "../../logger";

export interface EthersEth1Options extends IEth1Options {
  provider: ethers.providers.BaseProvider;
  contract?: Contract;
}

/**
 * Watch the Eth1.0 chain using Ethers
 */
export class EthersEth1Notifier extends EventEmitter implements IEth1Notifier {

  private provider: ethers.providers.BaseProvider;

  private contract: ethers.Contract;

  private db: BeaconDB;

  private genesisBlockHash: number64;

  private opts: EthersEth1Options;

  private _depositCount: number;

  private logger: ILogger;


  public constructor(opts: EthersEth1Options, {db, logger}: {db: any; logger: ILogger}) {
    super();
    this.logger = logger;
    this.opts = opts;
    this.provider = opts.provider;
    this.contract = opts.contract;
    this.db = db;
    this._depositCount = 0;
    this.genesisBlockHash = null;
  }

  public async start(): Promise<void> {
    if(!this.contract) {
      await this.initContract();
    }
    if(await this.isAfterEth2Genesis()) {
      this.logger.info('Eth2Genesis event exits, started listening on eth1 block updates');
      this.provider.on('block', this.processBlockHeadUpdate.bind(this));
    } else {
      const pastDeposits = await this.getContractDeposits(this.opts.depositContract.deployedAt);
      await Promise.all(pastDeposits.map((pastDeposit) => {
        return this.db.setGenesisDeposit(pastDeposit);
      }));
      this.provider.on('block', this.processBlockHeadUpdate.bind(this));
      this.contract.on('Deposit', this.processDepositLog.bind(this));
      this.contract.on('Eth2Genesis', this.processEth2GenesisLog.bind(this));
      this.logger.info(
        `Started listening on eth1 events on chain ${(await this.provider.getNetwork()).chainId}`
      );
    }


  }

  public async stop(): Promise<void> {
    this.provider.removeAllListeners('block');
    this.contract.removeAllListeners('Deposit');
    this.contract.removeAllListeners('Eth2Genesis');
  }

  public async processBlockHeadUpdate(blockNumber): Promise<void> {
    this.logger.debug(`Received eth1 block ${blockNumber}`);
    const block = await this.provider.getBlock(blockNumber);
    this.emit('block', block);
  }

  public async processDepositLog(
    pubkey: string, withdrawalCredentials: string,
    amount: string,
    signature: string,
    merkleTreeIndex: string
  ): Promise<void> {
    try {
      const deposit = this.createDeposit(
        pubkey,
        withdrawalCredentials,
        amount,
        signature,
        merkleTreeIndex
      );
      this.logger.info(
        `Received validator deposit event index=${deposit.index}`
      );
      if (deposit.index !== this._depositCount) {
        this.logger.warn(
          `Validator deposit with index=${deposit.index} received out of order. 
          (currentCount: ${this._depositCount})`
        );
        // deposit processed out of order
        return;
      }
      this._depositCount++;
      //after genesis stop storing in genesisDeposit bucket
      if (!this.genesisBlockHash) {
        await this.db.setGenesisDeposit(deposit);
      }
      this.emit('deposit', deposit);
    } catch (e) {
      this.logger.error(`Failed to process deposit log. Error: ${e.message}`);
    }
  }

  public async processEth2GenesisLog(
    depositRootHex: string,
    depositCountHex: string,
    timeHex: string,
    event: ethers.Event
  ): Promise<void> {
    try {
      const depositRoot = Buffer.from(depositRootHex.substr(2), 'hex');
      const depositCount = Buffer.from(depositCountHex.substr(2), 'hex').readUIntLE(0, 6);
      const time: number64 = parseInt(timeHex, 16);
      const blockHash = Buffer.from(event.blockHash.substr(2), 'hex');
      this.genesisBlockHash = event.blockNumber;
      this.logger.info(`Received Eth2Genesis event. blockNumber=${event.blockNumber}, time=${time}`);

      const genesisEth1Data: Eth1Data = {
        depositRoot,
        blockHash,
        depositCount,
      };
      const genesisDeposits = await this.genesisDeposits();
      this.emit('eth2genesis', time, genesisDeposits, genesisEth1Data);
      //from now on it will be kept in BeaconBlock
      await this.db.deleteGenesisDeposits(genesisDeposits);
    } catch (e) {
      this.logger.error(`Failed to process genesis log. Error: ${e.message}`);
    }

  }


  public async getContractDeposits(
    fromBlock: string | number  = this.opts.depositContract.deployedAt,
    toBlock?: string | number
  ): Promise<Deposit[]> {
    const logs = await this.getContractPastLogs(
      [this.contract.interface.events.Deposit.topic],
      fromBlock,
      toBlock
    );
    return logs.map((log) => {
      const logDescription = this.contract.interface.parseLog(log);
      return this.createDeposit(
        logDescription.values.pubkey,
        logDescription.values.withdrawalCredentials,
        logDescription.values.amount,
        logDescription.values.signature,
        logDescription.values.merkleTreeIndex
      );
    });
  }

  public async genesisDeposits(): Promise<Deposit[]> {
    return this.db.getGenesisDeposits();
  }

  public async getHead(): Promise<Block> {
    return this.getBlock('latest');
  }

  public async getBlock(blockHashOrBlockNumber: string | number): Promise<Block> {
    return this.provider.getBlock(blockHashOrBlockNumber, false);
  }

  public async depositRoot(block?: string | number): Promise<bytes32> {
    const depositRootHex = await this.contract.get_deposit_root({blockTag: block || 'latest'});
    return Buffer.from(depositRootHex.substr(2), 'hex');
  }

  public async depositCount(block?: string | number): Promise<number> {
    const depositCountHex = await this.contract.get_deposit_count({blockTag: block || 'latest'});
    return Buffer.from(depositCountHex.substr(2), 'hex').readUIntLE(0, 6);
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
      throw new Error('Eth1 deposit contract not found! Probably wrong eth1 rpc url');
    }
  }

  private async contractExists(address: string) {
    if (!isValidAddress(address)) return false;
    const code = await this.provider.getCode(address);
    return !(!code || code === '0x');
  }

  public async isAfterEth2Genesis(): Promise<boolean> {
    const logs = await this.getContractPastLogs([this.contract.interface.events.Eth2Genesis.topic]);
    return logs.length > 0;
  }

  private async getContractPastLogs(
    topics: string[],
    fromBlock: number64 | string = this.opts.depositContract.deployedAt,
    toBlock: number64 | string = null
  ): Promise<Log[]> {
    const filter = {
      fromBlock,
      toBlock,
      address: this.contract.address,
      topics
    };
    return await this.provider.getLogs(filter);
  }

  private createDeposit(
    pubkey: string,
    withdrawalCredentials: string,
    amount: string,
    signature: string,
    merkleTreeIndex: string): Deposit {
    return {
      proof: Array.from({length: DEPOSIT_CONTRACT_TREE_DEPTH}, () => Buffer.alloc(32)),
      index: deserialize(Buffer.from(merkleTreeIndex.substr(2), 'hex'), number64) as number64,
      data: {
        pubkey: Buffer.from(pubkey.slice(2), 'hex'),
        withdrawalCredentials: Buffer.from(withdrawalCredentials.slice(2), 'hex'),
        amount: deserialize(Buffer.from(amount.slice(2), 'hex'), Gwei) as Gwei,
        signature: Buffer.from(signature.slice(2), 'hex'),
      },
    };
  }
}
