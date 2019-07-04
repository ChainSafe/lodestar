import {EventEmitter} from "events";

import {bytes32, Deposit, number64} from "../../../../../types";

import {IEth1Notifier, IEth1Options} from "../../../../eth1";
import {Block} from "ethers/providers";

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface MockEth1Options extends IEth1Options {
}

export class MockEth1Notifier extends EventEmitter implements IEth1Notifier {
  public constructor(opts: MockEth1Options) {
    super();
  }

  public async start(): Promise<void> {
  }

  public async stop(): Promise<void> {
  }

  public async isAfterEth2Genesis(): Promise<boolean> {
    return true;
  }

  public async processBlockHeadUpdate(blockNumber): Promise<void> {
  }

  public async processDepositLog(dataHex: string, indexHex: string): Promise<void> {
  }

  public async processEth2GenesisLog(
    depositRootHex: string,
    depositCountHex: string,
    timeHex: string, event: object
  ): Promise<void> {
  }

  public async genesisDeposits(): Promise<Deposit[]> {
    return [];
  }

  public async depositRoot(): Promise<bytes32> {
    return Buffer.alloc(32);
  }

  public async getContractDeposits(fromBlock: string | number, toBlock?: string | number): Promise<Deposit[]> {
    return [];
  }

  public async getBlock(blockHashOrBlockNumber: string | number): Promise<Block> {
    return undefined;
  }

  public async getHead(): Promise<Block> {
    return undefined;
  }

  public async depositCount(block?: string | number): Promise<number64> {
    return undefined;
  }
}
