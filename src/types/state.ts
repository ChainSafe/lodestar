// Each type exported here contains both a compile-time type (a typescript interface) and a run-time type (a javascript variable)
// For more information, see ./index.ts
// These interfaces relate to the data structures for beacon chain state
import { SimpleContainerType } from "@chainsafe/ssz";

import {
  bytes32,
  bytes48,
  uint64,
} from "./primitive";

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
  epoch: uint64;
}
export const Fork: SimpleContainerType = {
  name: "Fork",
  fields: [
    ["previousVersion", uint64],
    ["currentVersion", uint64],
    ["epoch", uint64],
  ],
};

export interface Validator {
  // BLS public key
  pubkey: bytes48;
  // Withdrawal credentials
  withdrawalCredentials: bytes32;
  // Epoch when validator activated
  activationEpoch: uint64;
  // Slot when validator exited
  exitEpoch: uint64;
  // Slot when validator withdrew
  withdrawalEpoch: uint64;
  // Slot when validator was penalized
  slashedEpoch: uint64;
  // Status flags
  statusFlags: uint64;
}
export const Validator: SimpleContainerType = {
  name: "Validator",
  fields: [
    ["pubkey", bytes48],
    ["withdrawalCredentials", bytes32],
    ["activationEpoch", uint64],
    ["exitEpoch", uint64],
    ["withdrawalEpoch", uint64],
    ["slashedEpoch", uint64],
    ["statusFlags", uint64],
  ],
};

export interface BeaconState {
  // Misc
  slot: uint64;
  genesisTime: uint64;
  fork: Fork; // For versioning hard forks

  // Validator registry
  validatorRegistry: Validator[];
  validatorBalances: uint64[];
  validatorRegistryUpdateEpoch: uint64;

  // Randomness and committees
  latestRandaoMixes: bytes32[];
  previousShufflingStartShard: uint64;
  currentShufflingStartShard: uint64;
  previousShufflingEpoch: uint64;
  currentShufflingEpoch: uint64;
  previousShufflingSeed: bytes32;
  currentShufflingSeed: bytes32;

  // Finality
  previousJustifiedEpoch: uint64;
  justifiedEpoch: uint64;
  justificationBitfield: uint64;
  finalizedEpoch: uint64;

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
  depositIndex: uint64;
}
export const BeaconState: SimpleContainerType = {
  name: "BeaconState",
  fields: [
    // Misc
    ["slot", uint64],
    ["genesisTime", uint64],
    ["fork", Fork],
    // Validator Registry
    ["validatorRegistry", [Validator]],
    ["validatorBalances", [uint64]],
    ["validatorRegistryUpdateEpoch", uint64],
    // Randomness and committees
    ["latestRandaoMixes", [bytes32]],
    ["previousShufflingStartShard", uint64],
    ["currentShufflingStartShard", uint64],
    ["previousShufflingEpoch", uint64],
    ["currentShufflingEpoch", uint64],
    ["previousShufflingSeed", bytes32],
    ["currentShufflingSeed", bytes32],
    // Finality
    ["previousJustifiedEpoch", uint64],
    ["justifiedEpoch", uint64],
    ["justificationBitfield", uint64],
    ["finalizedEpoch", uint64],
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
    ["depositIndex", uint64],
  ],
};
