/**
 * @module eth1
 */

import {ethers} from "ethers";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {isValidAddress} from "../../util/address";
import {RetryProvider} from "./retryProvider";
import {IDepositEvent} from "../interface";
import {IEth1Options} from "../options";
import {depositContract} from "../depositContract";

const ETH1_BLOCK_RETRY = 3;

interface IEth1Block {
  hash: string;
  number: number;
  timestamp: number;
}

export class Eth1Provider {
  private opts: IEth1Options;

  private address: string;
  private provider: ethers.providers.Provider;
  private contract: ethers.Contract;

  private config: IBeaconConfig;

  public constructor(config: IBeaconConfig, opts: IEth1Options) {
    this.config = config;
    this.opts = opts;
    this.provider = new RetryProvider(ETH1_BLOCK_RETRY, opts.providerUrl, this.config.params.DEPOSIT_NETWORK_ID);
    this.address = toHexString(this.config.params.DEPOSIT_CONTRACT_ADDRESS);
    if (!isValidAddress(this.address)) {
      throw Error(`Invalid contract address: ${this.address}`);
    }
    this.contract = new ethers.Contract(this.address, depositContract.abi, this.provider);
  }

      this.logger.info("Eth1 notifier is disabled, no need to process eth1 for proposing data");
  async validateContract(): Promise<void> {
    const code = await this.provider.getCode(this.address);
    if (!code || code === "0x") {
      throw new Error(`There is no deposit contract at given address: ${this.address}`);
    }
  }

  async getBlockNumber(): Promise<number> {
    return await this.provider.getBlockNumber();
  }

  async getBlock(blockNumber: number): Promise<IEth1Block> {
    const block = await this.provider.getBlock(blockNumber);
    return {
      hash: block.hash,
      number: block.number,
      timestamp: block.timestamp,
    };
  }

  async getDepositEvents(fromBlock: number, toBlock?: number): Promise<IDepositEvent[]> {
    const filter = this.contract.filters.DepositEvent();
    const logs = await this.contract.queryFilter(filter, fromBlock, toBlock || fromBlock);
    return logs.map((log) => this.parseDepositEvent(log));
  }

  /**
   * Parse DepositEvent log
   */
  private parseDepositEvent(log: ethers.Event): IDepositEvent {
    const values = log.args;
    if (!values) throw Error(`DepositEvent ${log.transactionHash} has no values`);
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
