/* tslint:disable:no-var-keyword */
// TODO replace uint, bytes32, bytes

// Each type exported here contains both a compile-time type (a typescript interface) and a run-time type (a javascript variable)
// For more information, see ./index.ts

// These interfaces relate to the data structures for beacon chain state

import { AttestationData } from "./blocks";

type bytes = Uint8Array;
type bytes32 = Uint8Array;
type bytes48 = Uint8Array;
type int = number;
type uint24 = number;
type uint64 = number;
type uint384 = number;

const bytes = "Uint8Array";
const bytes32 = "Uint8Array";
const bytes48 = "Uint8Array";
const int = "int";
const uint24 = "uint24";
const uint64 = "uint64";
const uint384 = "uint384";

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
  previousEpochStartShard: uint64;
  currentEpochStartShard: uint64;
  previousCalculationEpoch: uint64;
  currentCalculationEpoch: uint64;
  previousEpochSeed: bytes32;
  currentEpochSeed: bytes32;

  // Finality
  previousJustifiedEpoch: uint64;
  justifiedEpoch: uint64;
  justificationBitfield: uint64;
  finalizedEpoch: uint64;

  // Recent state
  latestCrosslinks: Crosslink[];
  latestBlockRoots: bytes32[];
  latestIndexRoots: bytes32[];
  latestPenalizedBalances: uint64[]; // Balances penalized at every withdrawal period
  latestAttestations: PendingAttestation[];
  batchedBlockRoots: bytes32[];

  // Ethereum 1.0 deposit root
  latestEth1Data: Eth1Data;
  eth1DataVotes: Eth1DataVote[];
}
export var BeaconState = {
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
    ["previousEpochStartShard", uint64],
    ["currentEpochStartShard", uint64],
    ["previousCalculationEpoch", uint64],
    ["currentCalculationEpoch", uint64],
    ["previousEpochSeed", bytes32],
    ["currentEpochSeed", bytes32],
    // Finality
    ["previousJustifiedEpoch", uint64],
    ["justifiedEpoch", uint64],
    ["justificationBitfield", uint64],
    ["finalizedEpoch", uint64],
    // Recent State
    ["latestCrosslinks", [Crosslink]],
    ["latestBlockRoots", [bytes32]],
    ["latestIndexRoots", [bytes32]],
    ["latestPenalizedBalances", [uint64]],
    ["latestAttestations", [PendingAttestation]],
    ["batchedBlockRoots", [bytes32]],
    // Eth1
    ["latestEth1Data", Eth1Data],
    ["eth1DataVotes", [Eth1DataVote]],
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
  penalizedEpoch: uint64;
  // Status flags
  statusFlags: uint64;
}
export var Validator = {
  fields: [
    ["pubkey", bytes48],
    ["withdrawalCredentials", bytes32],
    ["activationEpoch", uint64],
    ["exitEpoch", uint64],
    ["withdrawalEpoch", uint64],
    ["penalizedEpoch", uint64],
    ["statusFlags", uint64],
  ],
};

export interface Crosslink {
  // Slot number
  epoch: uint64;
  // Shard chain block hash
  shardBlockRoot: bytes32;
}
export var Crosslink = {
  fields: [
    ["epoch", uint64],
    ["shardBlockRoot", bytes32],
  ],
};

export interface PendingAttestation {
  // Proof of custody bitfield
  aggregationBitfield: bytes;
  // Attester participation bitfield
  custodyBitfield: bytes;
  // Signed data
  data: AttestationData;
  // Slot in which it was included
  inclusionSlot: uint64;
}
export var PendingAttestation = {
  fields: [
    ["aggregationBitfield", bytes],
    ["custodyBitfield", bytes],
    ["data", AttestationData],
    ["inclusionSlot", uint64],
  ],
};

export interface Fork {
  // Previous fork version
  previousVersion: uint64;
  // Post fork version
  currentVersion: uint64;
  // Fork epoch number
  epoch: uint64;
}
export var Fork = {
  fields: [
    ["previousVersion", uint64],
    ["currentVersion", uint64],
    ["epoch", uint64],
  ],
};

export interface Eth1Data {
  // Root of the deposit tree
  depositRoot: bytes32;
  // Block hash
  blockHash: bytes32;
}
export var Eth1Data = {
  fields: [
    ["depositRoot", bytes32],
    ["blockHash", bytes32],
  ],
};

export interface Eth1DataVote {
  // Data being voted for
  eth1Data: Eth1Data;
  // Vote count
  voteCount: uint64;
}
export var Eth1DataVote = {
  fields: [
    ["eth1Data", Eth1Data],
    ["voteCount", uint64],
  ],
};
