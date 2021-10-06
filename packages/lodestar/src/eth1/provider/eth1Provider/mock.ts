import {toHexString} from "@chainsafe/ssz";
import {ZERO_HASH} from "../../../constants";
import {EthJsonRpcBlockRaw, IEth1Provider} from "../../interface";

export type Eth1ProviderMockOpts = {
  startDifficulty: number;
  difficultyIncrement: number;
  mergeBlockDifficulty: number;
  mergeBlockHash: string;
};

const defaultEth1ProviderMockOpts: Eth1ProviderMockOpts = {
  startDifficulty: 0,
  difficultyIncrement: 2,
  mergeBlockDifficulty: 0,
  mergeBlockHash: toHexString(ZERO_HASH),
};

export class Eth1ProviderMock implements IEth1Provider {
  readonly deployBlock = 0;
  private startDifficulty: number;
  private difficultyIncrement: number;
  private mergeBlockDifficulty: number;
  private mergeBlockHash: string;
  private blocks: EthJsonRpcBlockRaw[] = [];
  private blocksByHash = new Map<string, EthJsonRpcBlockRaw>();
  private latestBlockPointer = 0;

  constructor(opts: Eth1ProviderMockOpts = defaultEth1ProviderMockOpts) {
    this.startDifficulty = opts.startDifficulty;
    this.difficultyIncrement = opts.difficultyIncrement;
    this.mergeBlockDifficulty = opts.mergeBlockDifficulty;
    this.mergeBlockHash = opts.mergeBlockHash;
  }

  async getBlockNumber(): Promise<number> {
    return 0;
  }

  async getBlockByNumber(blockNumber: number | "latest"): Promise<EthJsonRpcBlockRaw | null> {
    // On each call simulate that the eth1 chain advances 1 block with +1 totalDifficulty
    if (blockNumber === "latest") return this.getLatestBlock(this.latestBlockPointer++);
    return this.blocks[blockNumber];
  }

  async getBlockByHash(blockHashHex: string): Promise<EthJsonRpcBlockRaw | null> {
    return this.blocksByHash.get(blockHashHex) ?? null;
  }

  async getBlocksByNumber(): Promise<never> {
    throw Error("Not implemented");
  }

  async getDepositEvents(): Promise<never> {
    throw Error("Not implemented");
  }

  async validateContract(): Promise<void> {
    throw Error("Not implemented");
  }

  private getLatestBlock(i: number): EthJsonRpcBlockRaw {
    const totalDifficulty = this.startDifficulty + i * this.difficultyIncrement;
    const block: EthJsonRpcBlockRaw = {
      number: toHex(i),
      hash: this.getBlockHash(i + 1, totalDifficulty),
      parentHash: toRootHex(i),
      totalDifficulty: toHex(totalDifficulty),
      timestamp: "0x0",
    };
    this.blocks.push(block);
    this.blocksByHash.set(block.hash, block);
    return block;
  }

  private getBlockHash(i: number, totalDifficulty: number): string {
    return totalDifficulty === this.mergeBlockDifficulty ? this.mergeBlockHash : toRootHex(i);
  }
}

function toHex(num: number | bigint): string {
  return num < 0 ? "" + num : "0x" + num.toString(16);
}

export function toRootHex(num: number): string {
  return "0x" + num.toString(16).padStart(64, "0");
}
