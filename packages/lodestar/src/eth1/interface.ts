/* eslint-disable @typescript-eslint/interface-name-prefix */

/**
 * @module eth1
 */

import {DepositData} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ethers} from "ethers";

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
  deployBlock: number;
  getBlockNumber(): Promise<number>;
  getBlock(blockNumber: number): Promise<IEth1Block>;
  getDepositEvents(fromBlock: number, toBlock?: number): Promise<IDepositEvent[]>;
  validateContract(): Promise<void>;
}

export interface IEth1Streamer {
  getDepositsStream(fromBlock: number): AsyncGenerator<IBatchDepositEvents>;
  getDepositsAndBlockStreamForGenesis(fromBlock: number): AsyncGenerator<[IDepositEvent[], IEth1Block]>;
}
