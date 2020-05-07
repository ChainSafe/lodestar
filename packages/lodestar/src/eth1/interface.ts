/* eslint-disable @typescript-eslint/interface-name-prefix */

/**
 * @module eth1
 */

import {EventEmitter} from "events";

import {Eth1Data, Number64, DepositData} from "@chainsafe/lodestar-types";
import {Block} from "ethers/providers";
import StrictEventEmitter from "strict-event-emitter-types";

export interface IDepositEvent extends DepositData {
  index: number;
}

export interface IEth1Events {
  deposit: (index: Number64, depositData: DepositData) => void;
  eth1Data: (timestamp: number, eth1Data: Eth1Data, blockNumber: number) => void;
}

export type Eth1EventEmitter = StrictEventEmitter<EventEmitter, IEth1Events>;

/**
 * The IEth1Notifier service watches the Eth1 chain for IEth1Events
 */
export interface IEth1Notifier extends Eth1EventEmitter {
  start(): Promise<void>;
  stop(): Promise<void>;

  /**
   * Returns block by block hash or number
   * @param blockHashOrBlockNumber
   */
  getBlock(blockTag: string | number): Promise<Block>;

  /**
   * Return deposit events at a block
   */
  getDepositEvents(blockTag: string | number): Promise<IDepositEvent[]>;
}

/**
 * Eth1 block range.
 */
export interface Eth1BlockRange {
  fromNumber: number;
  toNumber: number;
}
