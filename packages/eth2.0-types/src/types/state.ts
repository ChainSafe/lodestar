/* eslint-disable @typescript-eslint/interface-name-prefix */
/**
 * @module types
 */

import {BitVector} from "@chainsafe/bit-utils";

import {
  Gwei,
  Hash,
  number64,
  Slot,
} from "./primitive";

import {
  BeaconBlockHeader,
  Checkpoint,
  Eth1Data,
  Fork,
  PendingAttestation,
  Validator,
} from "./misc";


export interface BeaconState {
  // Misc
  genesisTime: number64;
  slot: Slot;
  fork: Fork; // For versioning hard forks

  // History
  latestBlockHeader: BeaconBlockHeader;
  blockRoots: Hash[];
  stateRoots: Hash[];
  historicalRoots: Hash[];
  
  // Eth1
  eth1Data: Eth1Data;
  eth1DataVotes: Eth1Data[];
  eth1DepositIndex: number64;
  
  // Registry
  validators: Validator[];
  balances: Gwei[];

  // Shuffling
  randaoMixes: Hash[];

  // Slashings
  slashings: Gwei[]; // Balances penalized at every withdrawal period
  
  // Attestations
  previousEpochAttestations: PendingAttestation[];
  currentEpochAttestations: PendingAttestation[];

  // Finality
  justificationBits: BitVector;
  previousJustifiedCheckpoint: Checkpoint;
  currentJustifiedCheckpoint: Checkpoint;
  finalizedCheckpoint: Checkpoint;
}
