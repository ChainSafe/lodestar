/* tslint:disable:no-var-keyword */
// TODO replace uint, hash32, bytes

// Each type exported here contains both a compile-time type (a typescript interface) and a run-time type (a javascript variable)
// For more information, see ./index.ts

// These interfaces relate to the data structures for beacon chain state

import { AttestationData } from "./blocks";

type bytes = number;
type int = number;
type uint24 = number;
type uint64 = number;
type uint384 = number;
type hash32 = Uint8Array;

const bytes = "bytes";
const int = "int";
const uint24 = "uint24";
const uint64 = "uint64";
const uint384 = "uint384";
const hash32 = "hash32";

export interface BeaconState {
  // Misc
  slot: uint64;
  genesisTime: uint64;
  forkData: ForkData; // For versioning hard forks

  // Validator registry
  validatorRegistry: ValidatorRecord[];
  validatorBalances: uint64[];
  validatorRegistryLatestChangeSlot: uint64;
  validatorRegistryExitCount: uint64;
  validatorRegistryDeltaChainTip: hash32; // For light clients to track deltas

  // Randomness and committees
  latestRandaoMixes: hash32[];
  latestVdfOutputs: hash32[];
  previousEpochStartShard: uint64;
  currentEpochStartShard: uint64;
  previousEpochCalculationSlot: uint64;
  currentEpochCalculationSlot: uint64;
  previousEpochRandaoMix: hash32;
  currentEpochRandaoMix: hash32;

  // Custody Challenges
  custodyChallenges: CustodyChallenge[];

  // Finality
  previousJustifiedSlot: uint64;
  justifiedSlot: uint64;
  justificationBitfield: uint64;
  finalizedSlot: uint64;

  // Recent state
  latestCrosslinks: CrosslinkRecord[];
  latestBlockRoots: hash32[]; // Needed to process attestations; older to newer
  latestPenalizedExitBalances: uint64[]; // Balances penalized at every withdrawal period
  latestAttestations: PendingAttestationRecord[];
  batchedBlockRoots: hash32[];

  // Ethereum 1.0 deposit root
  latestDepositRoot: hash32;
  depositRootVotes: DepositRootVote[];
}
export var BeaconState = {
  fields: [
    ["slot", uint64],
    ["genesisTime", uint64],
    ["forkData", ForkData],
    ["validatorRegistry", [ValidatorRecord]],
    ["validatorBalances", [uint64]],
    ["validatorRegistryLatestChangeSlot", uint64],
    ["validatorRegistryExitCount", uint64],
    ["validatorRegistryDeltaChainTip", hash32],
    ["latestRandaoMixes", [hash32]],
    ["latestVdfOutputs", [hash32]],
    ["previousEpochStartShard", uint64],
    ["currentEpochStartShard", uint64],
    ["previousEpochCalculationSlot", uint64],
    ["currentEpochCalculationSlot", uint64],
    ["previousEpochRandaoMix", hash32],
    ["currentEpochRandaoMix", hash32],
    ["custodyChallenges", [CustodyChallenge]],
    ["previousJustifiedSlot", uint64],
    ["justifiedSlot", uint64],
    ["justificationBitfield", uint64],
    ["finalizedSlot", uint64],
    ["latestCrosslinks", [CrosslinkRecord]],
    ["latestBlockRoots", [hash32]],
    ["latestPenalizedExitBalances", [uint64]],
    ["latestAttestations", [PendingAttestationRecord]],
    ["batchedBlockRoots", [hash32]],
    ["latestDepositRoot", hash32],
    ["depositRootVotes", [DepositRootVote]],
  ],
};

export interface ValidatorRecord {
  // BLS public key
  pubkey: uint384;
  // Withdrawal credentials
  withdrawalCredentials: hash32;
  // RANDAO commitment
  randaoCommitment: hash32;
  // Slots the proposer has skipped (i.e. layers of RANDAO expected)
  randaoLayers: uint64;
  // Status code
  activationSlot: uint64;
  // Slot when validator exited
  exitSlot: uint64;
  // Slot when validator withdrew
  withdrawalSlot: uint64;
  // Slot when validator was penalized
  penalizedSlot: uint64;
  // Exit counter when validator exited
  exitCount: uint64;
  // Status flags
  statusFlags: uint64;
  // Custody Commitment
  custodyCommitment: hash32;
  // Slot of latest custody reseed
  latestCustodyReseedSlot: uint64;
  // Slotof second-latest custody reseed
  penultimateCustodyResseedSlot: uint64;
}
export var ValidatorRecord = {
  fields: [
    ["pubkey", uint384],
    ["withdrawalCredentials", hash32],
    ["randaoCommitment", hash32],
    ["randaoLayers", uint64],
    ["activationSlot", uint64],
    ["exitSlot", uint64],
    ["withdrawalSlot", uint64],
    ["penalizedSlot", uint64],
    ["exitCount", uint64],
    ["statusFlags", uint64],
    ["custodyCommitment", hash32],
    ["latestCustodyReseedSlot", uint64],
    ["penultimateCustodyResseedSlot", uint64],
  ],
};

export interface CrosslinkRecord {
  // Slot number
  slot: uint64;
  // Shard chain block hash
  shardBlockRoot: hash32;
}
export var CrosslinkRecord = {
  fields: [
    ["slot", uint64],
    ["shardBlockRoot", hash32],
  ],
};

export interface DepositRootVote {
  // Deposit root
  depositRoot: hash32;
  // Vote count
  voteCount: uint64;
}
export var DepositRootVote = {
  fields: [
    ["depositRoot", hash32],
    ["voteCount", uint64],
  ],
};

export interface ShardCommittee {
  // Shard number
  shard: uint64;
  // Validator indices
  committee: uint24[];
  totalValidatorCount: uint64;
}
export var ShardCommittee = {
  fields: [
    ["shard", uint64],
    ["committee", [uint24]],
    ["totalValidatorCount", uint64],
  ],
};

export interface PendingAttestationRecord {
  // Signed data
  data: AttestationData;
  // Attester participation bitfield
  participationBitfield: bytes;
  // Proof of custody bitfield
  custodyBitfield: bytes;
  // Slot in which it was included
  slotIncluded: uint64;
}
export var PendingAttestationRecord = {
  fields: [
    ["data", AttestationData],
    ["participationBitfield", bytes],
    ["custodyBitfield", bytes],
    ["slotIncluded", uint64],
  ],
};

export interface ForkData {
  // Previous fork version
  preForkVersion: uint64;
  // Post fork version
  postForkVersion: uint64;
  // Fork slot number
  forkSlot: uint64;
}
export var ForkData = {
  fields: [
    ["preForkVersion", uint64],
    ["postForkVersion", uint64],
    ["forkSlot", uint64],
  ],
};

export interface ValidatorRegistryDeltaBlock {
  latestRegistryDeltaRoot: hash32;
  validatorIndex: uint64;
  pubkey: uint384;
  slot: uint64;
  flag: uint64;
}
export var ValidatorRegistryDeltaBlock = {
  fields: [
    ["latestRegistryDeltaRoot", hash32],
    ["validatorIndex", uint64],
    ["pubkey", uint384],
    ["slot", uint64],
    ["flag", uint64],
  ],
};

export interface ShardReassignmentRecord {
  // Which validator to reassign
  validatorIndex: uint24;
  // To which shard
  shard: uint64;
  // When
  slot: uint64;
}
export var ShardReassignmentRecord = {
  fields: [
    ["validatorIndex", uint24],
    ["shard", uint64],
    ["slot", uint64],
  ],
};

export interface CommitteeShard {
  committee: int[];
  shard: int;
}
export var CommitteeShard = {
  fields: [
    ["committee", [int]],
    ["shard", int],
  ],
};

/* tslint:disable:no-empty-interface*/
// Empty for Phase 0
export interface CustodyReseed {}
export var CustodyReseed = {
  fields: [],
};
export interface CustodyChallenge {}
export var CustodyChallenge = {
  fields: [],
};
export interface CustodyResponse {}
export var CustodyResponse = {
  fields: [],
};
/* tslint:enable:no-empty-interface*/
