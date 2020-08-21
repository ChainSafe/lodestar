/* eslint-disable @typescript-eslint/interface-name-prefix */

/**
 * @module eth1
 */

import {DepositData} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ethers} from "ethers";
import {Pushable} from "it-pushable";

export type IEthersAbi = Array<string | ethers.utils.EventFragment | ethers.utils.ParamType>;

export type IEth1StreamParams = Pick<
  IBeaconConfig["params"],
  "ETH1_FOLLOW_DISTANCE" | "MIN_GENESIS_TIME" | "GENESIS_DELAY" | "SECONDS_PER_ETH1_BLOCK"
> & {
  MAX_BLOCKS_PER_POLL: number;
};
export interface IDepositEvent extends DepositData {
  blockNumber: number;
  index: number;
}

export interface IBatchDepositEvents {
  depositEvents: IDepositEvent[];
  blockNumber: number;
}

export interface IEth1Block {
  hash: string;
  number: number;
  timestamp: number;
}

export interface IEth1Provider {
  getBlockNumber(): Promise<number>;
  getBlock(blockNumber: number): Promise<IEth1Block>;
  getDepositEvents(fromBlock: number, toBlock?: number): Promise<IDepositEvent[]>;
  validateContract(): Promise<void>;
}

export interface IEth1Streamer {
  getDepositsStream(fromBlock: number): AsyncGenerator<IBatchDepositEvents>;
  getDepositsAndBlockStreamForGenesis(fromBlock: number): AsyncGenerator<[IDepositEvent[], IEth1Block]>;
}

/**
 * The IEth1Notifier service watches the Eth1 chain for IEth1Events
 */
export interface IEth1Notifier {
  start(): Promise<void>;
  stop(): Promise<void>;
  getEth1BlockAndDepositEventsSource(): Promise<Pushable<Eth1EventsBlock>>;
  endEth1BlockAndDepositEventsSource(): Promise<void>;

  /**
   * Returns block by block hash or number
   * @param blockTag
   */
  getBlock(blockTag: string | number): Promise<Eth1Block | null>;

  /**
   * Return deposit events at a block
   */
  getDepositEvents(blockTag: string | number): Promise<IDepositEvent[]>;
}

/**
 * Eth1 block range.
 */
export interface Eth1BlockRange {
  fromNumber: number;
  toNumber: number;
}

/**
 * Eth1 block.
 */
export type Eth1Block = ethers.providers.Block;

/**
 * Eth1 Deposit Events and Block.
 */
export interface Eth1EventsBlock {
  events: IDepositEvent[];
  block?: Eth1Block;
}
