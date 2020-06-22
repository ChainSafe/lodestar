/* eslint-disable @typescript-eslint/interface-name-prefix */

/**
 * @module eth1
 */


import {DepositData} from "@chainsafe/lodestar-types";
import {ethers} from "ethers";
import {Pushable} from "it-pushable";

export type IEthersAbi = Array<string | ethers.utils.EventFragment | ethers.utils.ParamType>;

export interface IDepositEvent extends DepositData {
  blockNumber: number;
  index: number;
}


/**
 * The IEth1Notifier service watches the Eth1 chain for IEth1Events
 */
export interface IEth1Notifier {
  start(): Promise<void>;
  stop(): Promise<void>;
  startProcessEth1Blocks(subscribe?: boolean): Promise<Pushable<[IDepositEvent[], ethers.providers.Block]>>;
  unsubscribeEth1Blocks(): void;

  /**
   * Returns block by block hash or number
   * @param blockTag
   */
  getBlock(blockTag: string | number): Promise<ethers.providers.Block>;

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
