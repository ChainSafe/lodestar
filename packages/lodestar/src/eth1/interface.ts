/**
 * @module eth1
 */

import {EventEmitter} from "events";

import {BeaconState, Eth1Data, Number64, Root, DepositData} from "@chainsafe/eth2.0-types";
import {Block} from "ethers/providers";
import StrictEventEmitter from "strict-event-emitter-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

export interface IEth1Events {
  block: (block: Block) => void;
  deposit: (index: Number64, depositData: DepositData) => void;
}

export type Eth1EventEmitter = StrictEventEmitter<EventEmitter, IEth1Events>;

/**
 * The IEth1Notifier service watches the Eth1.0 chain for relevant events
 */
export interface IEth1Notifier extends Eth1EventEmitter {
  /**
   * If there isn't Eth2Genesis events in past logs, it should fetch
   * all the deposit logs from block at which contract is deployed.
   * If there is Eth2Genesis event in logs it should just listen for new eth1 blocks.
   */
  start(): Promise<void>;
  stop(): Promise<void>;

  /**
   * Process new block events sent from the Eth 1.0 chain
   */
  processBlockHeadUpdate(blockNumber: number|string): Promise<void>;

  /**
   * Process a Desposit log which has been received from the Eth 1.0 chain
   */
  processDepositLog(
    pubkey: string,
    withdrawalCredentials: string,
    amount: string,
    signature: string,
    merkleTreeIndex: string
  ): Promise<void>;

  /**
   * Obtains Deposit logs between given range of blocks
   * @param fromBlock either block hash or block number
   * @param toBlock optional, if not submitted it will assume latest
   */
  processPastDeposits(
    fromBlock: string | Number64, toBlock?: string | Number64
  ): Promise<void>;

  /**
   * Return the latest block
   */
  getHead(): Promise<Block>;

  /**
   * Returns block by block hash or number
   * @param blockHashOrBlockNumber
   */
  getBlock(blockHashOrBlockNumber: string | number): Promise<Block>;

  /**
   * Return the merkle root of the deposits
   */
  depositRoot(block?: string | number): Promise<Root>;

  /**
   * Retruns deposit count
   * @param block
   */
  depositCount(block?: string | number): Promise<Number64>;

  getEth1Vote(config: IBeaconConfig, state: BeaconState, previousEth1Distance: Number64): Promise<Eth1Data>;

  getEth1Data(eth1Head: Block, distance: Number64): Promise<Eth1Data>;
}
