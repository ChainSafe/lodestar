import BN from "bn.js";
import { EventEmitter } from "events";
import { ethers } from "ethers";
import { deserialize } from "@chainsafe/ssz";

import { bytes32, DepositData, Deposit, Eth1Data } from "../types";

import {Eth1Options, Eth1Notifier} from "./interface";
import logger from "../logger/winston";

export interface EthersEth1Options extends Eth1Options {
  provider: ethers.providers.Provider;
}

/**
 * Watch the Eth1.0 chain using Ethers
 */
export class EthersEth1Notifier extends EventEmitter implements Eth1Notifier {
  private provider: ethers.providers.BaseProvider;
  private contract: ethers.Contract;

  private _latestBlockHash: bytes32;
  private depositCount: number;
  private chainStarted: boolean;

  public constructor(opts) {
    super();
    this.provider = opts.provider;
    const address = opts.depositContract.address;
    const abi = opts.depositContract.abi;
    try {
      this.contract = new ethers.Contract(address, abi, this.provider);
    } catch (e) {
      //probably wrong address (contract not found or provider not connected
    }
    this.depositCount = 0;
  }

  public async start(): Promise<void> {
    if(!this.contract) {
      throw new Error('Eth1 deposit contract not found! Probably wrong rpc url or contract address');
    }
    this.provider.on('block', this.processBlockHeadUpdate.bind(this));
    this.contract.on('Deposit', this.processDepositLog.bind(this));
    this.contract.on('Eth2Genesis', this.processEth2GenesisLog.bind(this));
    logger.info(`Started listening on eth1 events on chain ${(await this.provider.getNetwork()).chainId}`)
  }

  public async stop(): Promise<void> {
    this.provider.removeAllListeners('block');
    this.contract.removeAllListeners('Deposit');
    this.contract.removeAllListeners('Eth2Genesis');
  }

  public async processBlockHeadUpdate(blockNumber): Promise<void> {
    logger.debug(`Received eth1 block ${blockNumber}`);
    const block = await this.provider.getBlock(blockNumber);
    this.emit('block', block);
  }

  public async processDepositLog(dataHex: string, indexHex: string): Promise<void> {
    const dataBuf = Buffer.from(dataHex.substr(2), 'hex');
    const index = Buffer.from(indexHex.substr(2), 'hex').readUIntLE(0, 6);

    logger.info(`Received validator deposit event index=${index}. Current deposit count=${this.depositCount}`);
    if (index !== this.depositCount) {
      logger.warn(`Validator deposit with index=${index} received out of order.`);
      // deposit processed out of order
      return;
    }
    this.depositCount++;

    const data: DepositData = deserialize(dataBuf, DepositData);

    // TODO: Add deposit to merkle trie/db
    this.emit('deposit', data, index);
  }

  public async processEth2GenesisLog(depositRootHex: string, depositCountHex: string, timeHex: string, event: ethers.Event): Promise<void> {
    const depositRoot = Buffer.from(depositRootHex.substr(2), 'hex');
    const depositCount = Buffer.from(depositCountHex.substr(2), 'hex').readUIntLE(0, 6);
    const time = new BN(Buffer.from(timeHex.substr(2), 'hex').readUIntLE(0, 6));
    const blockHash = Buffer.from(event.blockHash.substr(2), 'hex');
    logger.info(`Received Eth2Genesis event. blockNumber=${event.blockNumber}, time=${time}`);
    // TODO: Ensure the deposit root is the same that we've stored

    const genesisEth1Data: Eth1Data = {
      depositRoot,
      blockHash,
    };

    this.chainStarted = true;
    this.emit('eth2genesis', time, this.genesisDeposits(), genesisEth1Data);
  }

  public async genesisDeposits(): Promise<Deposit[]> {
    return [];
  }

  public async latestBlockHash(): Promise<bytes32> {
    return this._latestBlockHash;
  }

  public async depositRoot(): Promise<bytes32> {
    return Buffer.alloc(32);
  }

}
