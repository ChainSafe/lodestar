/* eslint-disable @typescript-eslint/interface-name-prefix */

/**
 * @module eth1
 */

import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ethers} from "ethers";
import {IDepositEvent, IEth1BlockHeader} from "./types";
import {TreeBacked} from "@chainsafe/ssz";
import {BeaconState, Eth1Data, Deposit} from "@chainsafe/lodestar-types";

export type IEthersAbi = Array<string | ethers.utils.EventFragment | ethers.utils.ParamType>;

export type IEth1StreamParams = Pick<
  IBeaconConfig["params"],
  "ETH1_FOLLOW_DISTANCE" | "MIN_GENESIS_TIME" | "GENESIS_DELAY" | "SECONDS_PER_ETH1_BLOCK"
> & {
  MAX_BLOCKS_PER_POLL: number;
};

export interface IBatchDepositEvents {
  depositEvents: IDepositEvent[];
  blockNumber: number;
}

export interface IEth1ForBlockProduction {
  getEth1DataAndDeposits(
    state: TreeBacked<BeaconState>
  ): Promise<{
    eth1Data: Eth1Data;
    deposits: Deposit[];
  }>;
}

export interface IEth1Provider {
  deployBlock: number;
  getBlockNumber(): Promise<number>;
  getBlock(blockNumber: number): Promise<IEth1BlockHeader>;
  getDepositEvents(fromBlock: number, toBlock?: number): Promise<IDepositEvent[]>;
  validateContract(): Promise<void>;
}

export interface IEth1Streamer {
  getDepositsStream(fromBlock: number): AsyncGenerator<IBatchDepositEvents>;
  getDepositsAndBlockStreamForGenesis(fromBlock: number): AsyncGenerator<[IDepositEvent[], IEth1BlockHeader]>;
}
