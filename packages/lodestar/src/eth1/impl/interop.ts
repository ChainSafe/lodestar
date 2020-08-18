/* eslint-disable @typescript-eslint/no-unused-vars,@typescript-eslint/no-empty-function */
import {EventEmitter} from "events";
import {ethers} from "ethers";

import {Eth1Data} from "@chainsafe/lodestar-types";

import {IEth1Notifier, IDepositEvent, Eth1EventsBlock} from "../interface";
import {Pushable} from "it-pushable";

export class InteropEth1Notifier extends EventEmitter implements IEth1Notifier {
  public constructor() {
    super();
  }

  public async start(): Promise<void> {}
  public async stop(): Promise<void> {}

  public async getEth1BlockAndDepositEventsSource(): Promise<Pushable<Eth1EventsBlock>> {
    return null;
  }
  public async endEth1BlockAndDepositEventsSource(): Promise<void> {}

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
