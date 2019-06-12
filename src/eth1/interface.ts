/**
 * @module eth1
 */

import {EventEmitter} from "events";

import {bytes32, Deposit, number64} from "../types";

export interface IEth1Options {
  depositContract: {
    deployedAt: number;
    address: string;
    abi: any[];
  };
}

/**
 * The IEth1Notifier service watches the Eth1.0 chain for relevant events
 */
export interface IEth1Notifier extends EventEmitter {
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
  processBlockHeadUpdate(blockNumber): Promise<void>;

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
   * Process a Eth2genesis log which has been received from the Eth 1.0 chain
   */
  processEth2GenesisLog(
    depositRootHex: string, depositCountHex: string, timeHex: string, event: object
  ): Promise<void>;

  /**
   * Obtains Deposit logs between given range of blocks
   * @param fromBlock either block hash or block number
   * @param toBlock optional, if not submitted it will assume latest
   */
  getContractDeposits(
    fromBlock: string | number64, toBlock?: string | number64
  ): Promise<Deposit[]>;

  /**
   * Return an array of deposits to process at genesis event
   */
  genesisDeposits(): Promise<Deposit[]>;

  /**
   * Return the latest block hash
   */
  latestBlockHash(): bytes32;

  /**
   * Return true if the eth2 genesis log has occurred
   */
  isAfterEth2Genesis(): Promise<boolean>;
  /**
   * Return the merkle root of the deposits
   */
  depositRoot(): Promise<bytes32>;

}
