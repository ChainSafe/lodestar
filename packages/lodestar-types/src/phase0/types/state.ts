/**
 * @module types
 */

import {BitVector, List, Vector} from "@chainsafe/ssz";

import {Bytes32, Gwei, Root, Number64, Slot} from "../../primitive/types";

import {BeaconBlockHeader, Checkpoint, Eth1Data, Fork, PendingAttestation, Validator} from "./misc";

export interface BeaconState {
  // Misc
  genesisTime: Number64;
  genesisValidatorsRoot: Root;
  slot: Slot;
  fork: Fork; // For versioning hard forks

  // History
  latestBlockHeader: BeaconBlockHeader;
  blockRoots: Vector<Root>;
  stateRoots: Vector<Root>;
  historicalRoots: List<Root>;

  // Eth1
  eth1Data: Eth1Data;
  eth1DataVotes: List<Eth1Data>;
  eth1DepositIndex: Number64;

  // Registry
  validators: List<Validator>;
  balances: List<Gwei>;

  // Shuffling
  randaoMixes: Vector<Bytes32>;

  // Slashings
  slashings: Vector<Gwei>; // Balances penalized at every withdrawal period

  // Attestations
  previousEpochAttestations: List<PendingAttestation>;
  currentEpochAttestations: List<PendingAttestation>;

  // Finality
  justificationBits: BitVector;
  previousJustifiedCheckpoint: Checkpoint;
  currentJustifiedCheckpoint: Checkpoint;
  finalizedCheckpoint: Checkpoint;
}
