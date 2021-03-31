/**
 * @module eth1
 */

import {AbortSignal} from "abort-controller";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks, phase0} from "@chainsafe/lodestar-types";
import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";

export interface IEth1Provider {
  deployBlock: number;
  getBlockNumber(signal?: AbortSignal): Promise<number>;
  getBlockByNumber(blockNumber: number, signal?: AbortSignal): Promise<phase0.Eth1Block>;
  getBlocksByNumber(fromBlock: number, toBlock: number, signal?: AbortSignal): Promise<phase0.Eth1Block[]>;
  getDepositEvents(fromBlock: number, toBlock: number, signal?: AbortSignal): Promise<phase0.DepositEvent[]>;
  validateContract(signal?: AbortSignal): Promise<void>;
}

export interface IEth1ForBlockProduction {
  getEth1DataAndDeposits(
    state: CachedBeaconState<allForks.BeaconState>
  ): Promise<{
    eth1Data: phase0.Eth1Data;
    deposits: phase0.Deposit[];
  }>;
}

export interface IBatchDepositEvents {
  depositEvents: phase0.DepositEvent[];
  blockNumber: number;
}

export interface IEth1Streamer {
  getDepositsStream(fromBlock: number): AsyncGenerator<IBatchDepositEvents>;
  getDepositsAndBlockStreamForGenesis(fromBlock: number): AsyncGenerator<[phase0.DepositEvent[], phase0.Eth1Block]>;
}

export type IEth1StreamParams = Pick<
  IBeaconConfig["params"],
  "ETH1_FOLLOW_DISTANCE" | "MIN_GENESIS_TIME" | "GENESIS_DELAY" | "SECONDS_PER_ETH1_BLOCK"
> & {
  maxBlocksPerPoll: number;
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
