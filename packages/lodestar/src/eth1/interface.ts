/**
 * @module eth1
 */

import {AbortSignal} from "abort-controller";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {TreeBacked} from "@chainsafe/ssz";
import {BeaconState, Eth1Data, Deposit, DepositEvent, Eth1Block} from "@chainsafe/lodestar-types";

export interface IEth1Provider {
  deployBlock: number;
  getBlockNumber(signal?: AbortSignal): Promise<number>;
  getBlockByNumber(blockNumber: number, signal?: AbortSignal): Promise<Eth1Block>;
  getBlocksByNumber(fromBlock: number, toBlock: number, signal?: AbortSignal): Promise<Eth1Block[]>;
  getDepositEvents(fromBlock: number, toBlock: number, signal?: AbortSignal): Promise<DepositEvent[]>;
  validateContract(signal?: AbortSignal): Promise<void>;
}

export interface IEth1ForBlockProduction {
  getEth1DataAndDeposits(
    state: TreeBacked<BeaconState>
  ): Promise<{
    eth1Data: Eth1Data;
    deposits: Deposit[];
  }>;
}

export interface IBatchDepositEvents {
  depositEvents: DepositEvent[];
  blockNumber: number;
}

export interface IEth1Streamer {
  getDepositsStream(fromBlock: number): AsyncGenerator<IBatchDepositEvents>;
  getDepositsAndBlockStreamForGenesis(fromBlock: number): AsyncGenerator<[DepositEvent[], Eth1Block]>;
}

export type IEth1StreamParams = Pick<
  IBeaconConfig["params"],
  "ETH1_FOLLOW_DISTANCE" | "MIN_GENESIS_TIME" | "GENESIS_DELAY" | "SECONDS_PER_ETH1_BLOCK"
> & {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  MAX_BLOCKS_PER_POLL: number;
};

export type IJson = string | number | boolean | undefined | IJson[] | {[key: string]: IJson};

export interface IRpcPayload {
  method: string;
  params: IJson[];
}

export interface IJsonRpcClient {
  fetch<R>({method, params}: IRpcPayload, signal?: AbortSignal): Promise<R>;
  fetchBatch<R>(rpcPayloadArr: IRpcPayload[], signal?: AbortSignal): Promise<R[]>;
}
