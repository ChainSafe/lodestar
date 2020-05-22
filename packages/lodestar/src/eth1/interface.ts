/* eslint-disable @typescript-eslint/interface-name-prefix */

/**
 * @module eth1
 */

import {EventEmitter} from "events";

import {Number64, DepositData} from "@chainsafe/lodestar-types";
import {Block} from "ethers/providers";
import StrictEventEmitter from "strict-event-emitter-types";
import {Pushable} from "it-pushable";

export interface IDepositEvent extends DepositData {
  index: number;
  blockNumber: number;
}

export interface IEth1Events {
  deposit: (index: Number64, depositData: DepositData) => void;
}

export type Eth1EventEmitter = StrictEventEmitter<EventEmitter, IEth1Events>;

/**
 * The IEth1Notifier service watches the Eth1 chain for IEth1Events
 */
export interface IEth1Notifier extends Eth1EventEmitter {
  start(): Promise<void>;
  stop(): Promise<void>;
  getDepositEventsByBlock(isScanEth1ForGenesis: boolean, fromBlock?: number): Promise<Pushable<IDepositEvent[]>>;
  foundGenesis(): Promise<void>;
  /**
   * Returns block by block hash or number
   * @param blockTag
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