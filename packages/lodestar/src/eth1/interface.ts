/**
 * @module eth1
 */

import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks, phase0, Root, RootHex} from "@chainsafe/lodestar-types";
import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";

export type EthJsonRpcBlockRaw = {
  /** the block number. null when its pending block. `"0x1b4"` */
  number: string;
  /** 32 Bytes - hash of the block. null when its pending block. `"0xdc0818cf78f21a8e70579cb46a43643f78291264dda342ae31049421c82d21ae"` */
  hash: string;
  /** 32 Bytes - hash of the parent block. `"0xe99e022112df268087ea7eafaf4790497fd21dbeeb6bd7a1721df161a6657a54"` */
  parentHash: string;
  /**
   * integer of the total difficulty of the chain until this block. `"0x78ed983323d"`.
   * Current mainnet value is 0x684de10dc5c03f006b6, 75 bits so requires a bigint.
   */
  totalDifficulty: string;
  /** the unix timestamp for when the block was collated. `"0x55ba467c"` */
  timestamp: string;
};

export interface IEth1Provider {
  deployBlock: number;
  getBlockNumber(): Promise<number>;
  /** Returns HTTP code 200 + value=null if block is not found */
  getBlockByNumber(blockNumber: number | "latest"): Promise<EthJsonRpcBlockRaw | null>;
  /** Returns HTTP code 200 + value=null if block is not found */
  getBlockByHash(blockHashHex: string): Promise<EthJsonRpcBlockRaw | null>;
  /** null returns are ignored, may return a different number of blocks than expected */
  getBlocksByNumber(fromBlock: number, toBlock: number): Promise<EthJsonRpcBlockRaw[]>;
  getDepositEvents(fromBlock: number, toBlock: number): Promise<phase0.DepositEvent[]>;
  validateContract(): Promise<void>;
}

export type Eth1DataAndDeposits = {
  eth1Data: phase0.Eth1Data;
  deposits: phase0.Deposit[];
};

export interface IEth1ForBlockProduction {
  getEth1DataAndDeposits(state: CachedBeaconState<allForks.BeaconState>): Promise<Eth1DataAndDeposits>;

  /** Returns the most recent POW block that satisfies the merge block condition */
  getTerminalPowBlock(): Root | null;
  /** Call when merge is irrevocably completed to stop polling unnecessary data from the eth1 node */
  mergeCompleted(): void;
  /** Get a POW block by hash checking the local cache first */
  getPowBlock(powBlockHash: string): Promise<PowMergeBlock | null>;
}

export type PowMergeBlock = {
  number: number;
  blockhash: RootHex;
  parentHash: RootHex;
  totalDifficulty: bigint;
};

export interface IBatchDepositEvents {
  depositEvents: phase0.DepositEvent[];
  blockNumber: number;
}

export interface IEth1Streamer {
  getDepositsStream(fromBlock: number): AsyncGenerator<IBatchDepositEvents>;
  getDepositsAndBlockStreamForGenesis(fromBlock: number): AsyncGenerator<[phase0.DepositEvent[], phase0.Eth1Block]>;
}

export type IEth1StreamParams = Pick<
  IBeaconConfig,
  "ETH1_FOLLOW_DISTANCE" | "MIN_GENESIS_TIME" | "GENESIS_DELAY" | "SECONDS_PER_ETH1_BLOCK"
> & {
  maxBlocksPerPoll: number;
};

export type IJson = string | number | boolean | undefined | IJson[] | {[key: string]: IJson};

export interface IRpcPayload<P = IJson[]> {
  method: string;
  params: P;
}

export type ReqOpts = {
  timeout?: number;
};
