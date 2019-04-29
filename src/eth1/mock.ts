import {EventEmitter} from "events";

import {bytes32, DepositData, Deposit, Eth1Data} from "../types";

import {Eth1Notifier, Eth1Options} from "./interface";

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface MockEth1Options extends Eth1Options {
}

export class MockEth1Notifier extends EventEmitter implements Eth1Notifier {
  public constructor(opts: MockEth1Options) {
    super();
  }

  public async start(): Promise<void> {
  }
  public async stop(): Promise<void> {
  }

  public async processBlockHeadUpdate(blockNumber): Promise<void> {}
  public async processDepositLog(dataHex: string, indexHex: string): Promise<void> {}
  public async processEth2GenesisLog(depositRootHex: string, depositCountHex: string, timeHex: string, event: object): Promise<void> {}
  public async genesisDeposits(): Promise<Deposit[]> {
    return [];
  }
  public async latestBlockHash(): Promise<bytes32> {
    return Buffer.alloc(32);
  }
  public async depositRoot(): Promise<bytes32> {
    return Buffer.alloc(32);
  }
}
