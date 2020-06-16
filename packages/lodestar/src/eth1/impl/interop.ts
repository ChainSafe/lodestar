/* eslint-disable @typescript-eslint/no-unused-vars,@typescript-eslint/no-empty-function */
import {EventEmitter} from "events";
import {ethers} from "ethers";

import {hash} from "@chainsafe/ssz";
import {Eth1Data, DepositData} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {IEth1Notifier, IDepositEvent} from "../interface";

export class InteropEth1Notifier extends EventEmitter implements IEth1Notifier {
  public constructor() {
    super();
  }

  public async start(): Promise<void> {}
  public async stop(): Promise<void> {}

  public async getDepositRoot(): Promise<Uint8Array> {
    return Buffer.alloc(32);
  }
  public async getDepositCount(blockTag: string | number): Promise<number> {
    return 0;
  }
  public async getEth1Data(blockHash: string): Promise<Eth1Data> {
    return null as unknown as Eth1Data;
  }
  public async getDepositEvents(blockTag: string | number): Promise<IDepositEvent[]> {
    return [];
  }
  public async getBlock(blockTag: string | number): Promise<ethers.providers.Block> {
    return null as unknown as ethers.providers.Block;
  }
}
