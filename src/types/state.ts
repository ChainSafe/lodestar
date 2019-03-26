// Each type exported here contains both a compile-time type (a typescript interface) and a run-time type (a javascript variable)
// For more information, see ./index.ts
// These interfaces relate to the data structures for beacon chain state
import { SimpleContainerType } from "@chainsafe/ssz";

import {
  bytes32,
  bytes48,
  uint64,
  number64,
} from "./primitive";

import {
  Epoch,
  Slot,
  Shard,
} from "./custom";

import {
  Crosslink,
  PendingAttestation,
} from "./attestation";

import {
  Eth1Data,
  Eth1DataVote,
} from "./eth1";

export interface Fork {
  // Previous fork version
  previousVersion: uint64;
  // Post fork version
  currentVersion: uint64;
  // Fork epoch number
  epoch: Epoch;
}
export const Fork: SimpleContainerType = {
  name: "Fork",
  fields: [
    ["previousVersion", uint64],
    ["currentVersion", uint64],
    ["epoch", Epoch],
  ],
};

export interface Validator {
  // BLS public key
  pubkey: bytes48;
  // Withdrawal credentials
  withdrawalCredentials: bytes32;
  // Epoch when validator activated
  activationEpoch: Epoch;
  // Slot when validator exited
  exitEpoch: Epoch;
  // Slot when validator withdrew
  withdrawalEpoch: Epoch;
  // Slot when validator was penalized
  slashedEpoch: Epoch;
  // Status flags
  statusFlags: uint64;
}
export const Validator: SimpleContainerType = {
  name: "Validator",
  fields: [
    ["pubkey", bytes48],
    ["withdrawalCredentials", bytes32],
    ["activationEpoch", Epoch],
    ["exitEpoch", Epoch],
    ["withdrawalEpoch", Epoch],
    ["slashedEpoch", Epoch],
    ["statusFlags", uint64],
  ],
};

export interface BeaconState {
  // Misc
  slot: Slot;
  genesisTime: number64;
  fork: Fork; // For versioning hard forks

  // Validator registry
  validatorRegistry: Validator[];
  validatorBalances: uint64[];
  validatorRegistryUpdateEpoch: Epoch;

  // Randomness and committees
  latestRandaoMixes: bytes32[];
  previousShufflingStartShard: Shard;
  currentShufflingStartShard: Shard;
  previousShufflingEpoch: Epoch;
  currentShufflingEpoch: Epoch;
  previousShufflingSeed: bytes32;
  currentShufflingSeed: bytes32;

  // Finality
  previousJustifiedEpoch: Epoch;
  justifiedEpoch: Epoch;
  justificationBitfield: uint64;
  finalizedEpoch: Epoch;

  // Recent state
  latestCrosslinks: Crosslink[];
  latestBlockRoots: bytes32[];
  latestActiveIndexRoots: bytes32[];
  latestSlashedBalances: uint64[]; // Balances penalized at every withdrawal period
  latestAttestations: PendingAttestation[];
  batchedBlockRoots: bytes32[];

  // Ethereum 1.0 deposit root
  latestEth1Data: Eth1Data;
  eth1DataVotes: Eth1DataVote[];
  depositIndex: number64;
}
export const BeaconState: SimpleContainerType = {
  name: "BeaconState",
  fields: [
    // Misc
    ["slot", Slot],
    ["genesisTime", number64],
    ["fork", Fork],
    // Validator Registry
    ["validatorRegistry", [Validator]],
    ["validatorBalances", [uint64]],
    ["validatorRegistryUpdateEpoch", Epoch],
    // Randomness and committees
    ["latestRandaoMixes", [bytes32]],
    ["previousShufflingStartShard", Shard],
    ["currentShufflingStartShard", Shard],
    ["previousShufflingEpoch", Epoch],
    ["currentShufflingEpoch", Epoch],
    ["previousShufflingSeed", bytes32],
    ["currentShufflingSeed", bytes32],
    // Finality
    ["previousJustifiedEpoch", Epoch],
    ["justifiedEpoch", Epoch],
    ["justificationBitfield", uint64],
    ["finalizedEpoch", Epoch],
    // Recent State
    ["latestCrosslinks", [Crosslink]],
    ["latestBlockRoots", [bytes32]],
    ["latestActiveIndexRoots", [bytes32]],
    ["latestSlashedBalances", [uint64]],
    ["latestAttestations", [PendingAttestation]],
    ["batchedBlockRoots", [bytes32]],
    // Eth1
    ["latestEth1Data", Eth1Data],
    ["eth1DataVotes", [Eth1DataVote]],
    ["depositIndex", number64],
  ],
};
