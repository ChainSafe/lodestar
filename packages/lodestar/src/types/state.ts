/**
 * @module types
 */

import {
  bytes32,
  number64,
  uint64,
  Epoch,
  Shard,
  Slot,
  Gwei,
} from "./primitive";

import {
  BeaconBlockHeader,
  Crosslink,
  Eth1Data,
  Fork,
  PendingAttestation,
  Validator,
} from "./misc";


export interface BeaconState {
  // Misc
  slot: Slot;
  genesisTime: number64;
  fork: Fork; // For versioning hard forks

  // Validator registry
  validatorRegistry: Validator[];
  balances: Gwei[];

  // Randomness and committees
  latestRandaoMixes: bytes32[];
  latestStartShard: Shard;

  // Finality
  previousEpochAttestations: PendingAttestation[];
  currentEpochAttestations: PendingAttestation[];
  previousJustifiedEpoch: Epoch;
  currentJustifiedEpoch: Epoch;
  previousJustifiedRoot: bytes32;
  currentJustifiedRoot: bytes32;
  justificationBitfield: uint64;
  finalizedEpoch: Epoch;
  finalizedRoot: bytes32;

  // Recent state
  currentCrosslinks: Crosslink[];
  previousCrosslinks: Crosslink[];
  latestBlockRoots: bytes32[];
  latestStateRoots: bytes32[];
  latestActiveIndexRoots: bytes32[];
  latestSlashedBalances: Gwei[]; // Balances penalized at every withdrawal period
  latestBlockHeader: BeaconBlockHeader; // `latest_block_header.state_root == ZERO_HASH` temporarily
  historicalRoots: bytes32[];

  // Ethereum 1.0 deposit root
  latestEth1Data: Eth1Data;
  eth1DataVotes: Eth1Data[];
  depositIndex: number64;
}
