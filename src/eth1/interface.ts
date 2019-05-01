import {EventEmitter} from "events";

import {bytes32, DepositData, Deposit, Eth1Data} from "../types";

export interface Eth1Options {
  depositContract: {
    address: string;
    abi: any[];
  };
}

/**
 * The Eth1Notifier service watches the Eth1.0 chain for relevant events
 */
export interface Eth1Notifier extends EventEmitter {
  start(): Promise<void>;
  stop(): Promise<void>;

  /**
   * Process new block events sent from the Eth 1.0 chain
   */
  processBlockHeadUpdate(blockNumber): Promise<void>;

  /**
   * Process a Desposit log which has been received from the Eth 1.0 chain
   */
  processDepositLog(dataHex: string, indexHex: string): Promise<void>;

  /**
   * Process a Eth2genesis log which has been received from the Eth 1.0 chain
   */
  processEth2GenesisLog(depositRootHex: string, depositCountHex: string, timeHex: string, event: object): Promise<void>;

  /**
   * Return an array of deposits to process at genesis
   */
  genesisDeposits(): Promise<Deposit[]>;

  /**
   * Return the latest block hash
   */
  latestBlockHash(): bytes32;

  /**
   * Return the merkle root of the deposits
   */
  depositRoot(): Promise<bytes32>;

}
