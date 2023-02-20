import {BeaconConfig} from "@lodestar/config";
import {phase0, Root, RootHex} from "@lodestar/types";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";

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
  getEth1DataAndDeposits(state: CachedBeaconStateAllForks): Promise<Eth1DataAndDeposits>;

  /** Returns the most recent POW block that satisfies the merge block condition */
  getTerminalPowBlock(): Promise<Root | null>;
  /** Get a POW block by hash checking the local cache first */
  getPowBlock(powBlockHash: string): Promise<PowMergeBlock | null>;

  /** Get current TD progress for log notifier */
  getTDProgress(): TDProgress | null;

  /**
   * Should only start polling for mergeBlock if:
   * - after BELLATRIX_FORK_EPOCH
   * - Beacon node synced
   * - head state not isMergeTransitionComplete
   */
  startPollingMergeBlock(): void;
}

/** Different Eth1Block from phase0.Eth1Block with blockHash */
export type Eth1Block = {
  blockHash: Uint8Array;
  blockNumber: number;
  timestamp: number;
};

export type PowMergeBlock = {
  number: number;
  blockHash: RootHex;
  parentHash: RootHex;
  totalDifficulty: bigint;
};

export type PowMergeBlockTimestamp = PowMergeBlock & {
  /** in seconds */
  timestamp: number;
};

export type TDProgress =
  | {
      ttdHit: false;
      /** Power of ten by which tdDiffScaled is scaled down */
      tdFactor: bigint;
      /** (TERMINAL_TOTAL_DIFFICULTY - block.totalDifficulty) / tdFactor */
      tdDiffScaled: number;
      /** TERMINAL_TOTAL_DIFFICULTY */
      ttd: bigint;
      /** totalDifficulty of latest fetched eth1 block */
      td: bigint;
      /** timestamp in sec of latest fetched eth1 block */
      timestamp: number;
    }
  | {ttdHit: true};

export type BatchDepositEvents = {
  depositEvents: phase0.DepositEvent[];
  blockNumber: number;
};

export type Eth1Streamer = {
  getDepositsStream(fromBlock: number): AsyncGenerator<BatchDepositEvents>;
  getDepositsAndBlockStreamForGenesis(fromBlock: number): AsyncGenerator<[phase0.DepositEvent[], phase0.Eth1Block]>;
};

export type IEth1StreamParams = Pick<
  BeaconConfig,
  "ETH1_FOLLOW_DISTANCE" | "MIN_GENESIS_TIME" | "GENESIS_DELAY" | "SECONDS_PER_ETH1_BLOCK"
> & {
  maxBlocksPerPoll: number;
};

export type IJson = string | number | boolean | undefined | IJson[] | {[key: string]: IJson};

export interface RpcPayload<P = IJson[]> {
  method: string;
  params: P;
}
