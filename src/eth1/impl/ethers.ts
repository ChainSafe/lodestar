import BN from "bn.js";
import {EventEmitter} from "events";
import {Contract, ethers} from "ethers";
import {deserialize} from "@chainsafe/ssz";

import {bytes32, Deposit, DepositData, Eth1Data, number64} from "../../types";

import {Eth1Notifier, Eth1Options} from "../interface";
import logger from "../../logger";
import {isValidAddress} from "../../util/address";
import {DB} from "../../db";

export interface EthersEth1Options extends Eth1Options {
  provider: ethers.providers.BaseProvider;
  contract?: Contract;
}

/**
 * Watch the Eth1.0 chain using Ethers
 */
export class EthersEth1Notifier extends EventEmitter implements Eth1Notifier {

  private provider: ethers.providers.BaseProvider;

  private contract: ethers.Contract;

  private db: DB;

  private _latestBlockHash: bytes32;

  private genesisBlockHash: number64;

  private depositCount: number;

  private opts: EthersEth1Options;


  public constructor(opts: EthersEth1Options, {db}) {
    super();
    this.opts = opts;
    this.provider = opts.provider;
    this.contract = this.opts.contract;
    this.db = db;
    this.depositCount = 0;
    this._latestBlockHash = null;
    this.genesisBlockHash = null;
  }

  public async start(): Promise<void> {
    if(!this.contract) {
      await this.initContract();
    }
    this.provider.on('block', this.processBlockHeadUpdate.bind(this));
    this.contract.on('Deposit', this.processDepositLog.bind(this));
    this.contract.on('Eth2Genesis', this.processEth2GenesisLog.bind(this));
    logger.info(
      `Started listening on eth1 events on chain ${(await this.provider.getNetwork()).chainId}`
    );
  }

  public async stop(): Promise<void> {
    this.provider.removeAllListeners('block');
    this.contract.removeAllListeners('Deposit');
    this.contract.removeAllListeners('Eth2Genesis');
  }

  public async processBlockHeadUpdate(blockNumber): Promise<void> {
    logger.debug(`Received eth1 block ${blockNumber}`);
    const block = await this.provider.getBlock(blockNumber);
    this._latestBlockHash = Buffer.from(block.hash.substr(2), 'hex');
    this.emit('block', block);
  }

  public async processDepositLog(dataHex: string, indexHex: string): Promise<void> {
    const dataBuf = Buffer.from(dataHex.substr(2), 'hex');
    const index = Buffer.from(indexHex.substr(2), 'hex').readUIntLE(0, 6);

    logger.info(
      `Received validator deposit event index=${index}. Current deposit count=${this.depositCount}`
    );
    if (index !== this.depositCount) {
      logger.warn(`Validator deposit with index=${index} received out of order.`);
      // deposit processed out of order
      return;
    }
    this.depositCount++;
    const data: DepositData = deserialize(dataBuf, DepositData);
    const deposit: Deposit = {
      index: index,
      //TODO: calculate proof
      proof: [],
      data
    };
    //after genesis stop storing in genesisDeposit bucket
    if(!this.genesisBlockHash) {
      await this.db.setGenesisDeposit(deposit);
    }
    this.emit('deposit', deposit);
  }

  public async processEth2GenesisLog(
    depositRootHex: string,
    depositCountHex: string,
    timeHex: string,
    event: ethers.Event
  ): Promise<void> {
    const depositRoot = Buffer.from(depositRootHex.substr(2), 'hex');
    const depositCount = Buffer.from(depositCountHex.substr(2), 'hex').readUIntLE(0, 6);
    const time = new BN(Buffer.from(timeHex.substr(2), 'hex').readUIntLE(0, 6));
    const blockHash = Buffer.from(event.blockHash.substr(2), 'hex');
    this.genesisBlockHash = event.blockNumber;
    logger.info(`Received Eth2Genesis event. blockNumber=${event.blockNumber}, time=${time}`);

    const genesisEth1Data: Eth1Data = {
      depositRoot,
      blockHash,
      depositCount,
    };
    const genesisDeposits = await this.genesisDeposits();
    this.emit('eth2genesis', time, genesisDeposits, genesisEth1Data);
    //from now on it will be kept in BeaconBlock
    await this.db.deleteGenesisDeposits(genesisDeposits);
  }

  public async genesisDeposits(): Promise<Deposit[]> {
    return this.db.getGenesisDeposits();
  }

  public latestBlockHash(): bytes32 {
    return this._latestBlockHash;
  }

  public async depositRoot(): Promise<bytes32> {
    const depositRootHex = await this.contract.get_deposit_root();
    return Buffer.from(depositRootHex.substr(2), 'hex');
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

}
