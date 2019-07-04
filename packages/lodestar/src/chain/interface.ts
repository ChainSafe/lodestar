import {EventEmitter} from "events";

import {Attestation, BeaconBlock, BeaconState, Deposit, Eth1Data, number64, uint16, uint64} from "../../types";

import {LMDGHOST} from "./forkChoice";

/**
 * The IBeaconChain service deals with processing incoming blocks, advancing a state transition
 * and applying the fork choice rule to update the chain head
 */
export interface IBeaconChain extends EventEmitter {
  genesisTime: number64;
  forkChoice: LMDGHOST;
  chainId: uint16;
  networkId: uint64;
  /**
   * Start beacon chain processing
   */
  start(): Promise<void>;

  /**
   * Stop beacon chain processing
   */
  stop(): Promise<void>;

  /**
   * Initialize the beacon chain with a genesis beacon state / block
   */
  initializeChain(
    genesisTime: number64,
    genesisDeposits: Deposit[],
    genesisEth1Data: Eth1Data
  ): Promise<void>;

  /**
   * Add attestation to the fork-choice rule
   */
  receiveAttestation(attestation: Attestation): Promise<void>;

  /**
   * Pre-process and run the per slot state transition function
   */
  receiveBlock(block: BeaconBlock): Promise<void>;

  /**
   * Update the chain head using LMD GHOST
   */
  applyForkChoiceRule(): Promise<void>;

  /**
   * Ensure that the block is compliant with block processing validity conditions
   */
  isValidBlock(state: BeaconState, block: BeaconBlock): Promise<boolean>;
}
