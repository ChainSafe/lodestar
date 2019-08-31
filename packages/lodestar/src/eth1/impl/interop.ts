import {EventEmitter} from "events";

import {bytes32, number64} from "@chainsafe/eth2.0-types";

import {IEth1Notifier} from "../";
import {Block} from "ethers/providers";

export class InteropEth1Notifier extends EventEmitter implements IEth1Notifier {
  public constructor() {
    super();
  }

  public async start(): Promise<void> {
  }

  public async stop(): Promise<void> {
  }

  public async processBlockHeadUpdate(blockNumber): Promise<void> {
  }

  public async processDepositLog(dataHex: string, indexHex: string): Promise<void> {
  }

  public async depositRoot(): Promise<bytes32> {
    return Buffer.alloc(32);
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

  public async processPastDeposits(fromBlock: string | number, toBlock?: string | number): Promise<void> {
    return undefined;
  }
}
