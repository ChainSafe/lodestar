/* eslint-disable @typescript-eslint/interface-name-prefix */
/**
 * @module types
 */

import {ArrayLike} from "@chainsafe/ssz";

import {
  Bytes32,
  Gwei,
  Root,
  Number64,
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
  genesisTime: Number64;
  slot: Slot;
  fork: Fork; // For versioning hard forks

  // History
  latestBlockHeader: BeaconBlockHeader;
  blockRoots: ArrayLike<Root>;
  stateRoots: ArrayLike<Root>;
  historicalRoots: ArrayLike<Root>;
  
  // Eth1
  eth1Data: Eth1Data;
  eth1DataVotes: ArrayLike<Eth1Data>;
  eth1DepositIndex: Number64;
  
  // Registry
  validators: ArrayLike<Validator>;
  balances: ArrayLike<Gwei>;

  // Shuffling
  randaoMixes: ArrayLike<Bytes32>;

  // Slashings
  slashings: ArrayLike<Gwei>; // Balances penalized at every withdrawal period
  
  // Attestations
  previousEpochAttestations: ArrayLike<PendingAttestation>;
  currentEpochAttestations: ArrayLike<PendingAttestation>;

  // Finality
  justificationBits: ArrayLike<boolean>;
  previousJustifiedCheckpoint: Checkpoint;
  currentJustifiedCheckpoint: Checkpoint;
  finalizedCheckpoint: Checkpoint;
}
