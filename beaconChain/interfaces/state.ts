// TODO replace uint, hash32, bytes

// These interfaces relate to the data structures for beacon chain state

import { AttestationData } from "./blocks";

type bytes = number;
type uint24 = number;
type uint64 = number;
type uint384 = number;
type hash32 = Uint8Array;

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

export interface CrosslinkRecord {
  // Slot number
  slot: uint64;
  // Shard chain block hash
  shardBlockRoot: hash32;
}

export interface DepositRootVote {
  // Deposit root
  depositRoot: hash32;
  // Vote count
  voteCount: uint64;
}

export interface ShardCommittee {
  // Shard number
  shard: uint64;
  // Validator indices
  committee: uint24[];
  totalValidatorCount: uint64;
}

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


export interface ForkData {
  // Previous fork version
  preForkVersion: uint64;
  // Post fork version
  postForkVersion: uint64;
  // Fork slot number
  forkSlot: uint64;
}

export interface ValidatorRegistryDeltaBlock {
  latestRegistryDeltaRoot: hash32;
  validatorIndex: uint64;
  pubkey: uint384;
  slot: uint64;
  flag: uint64;
}

export interface ShardReassignmentRecord {
  // Which validator to reassign
  validatorIndex: uint24;
  // To which shard
  shard: uint64;
  // When
  slot: uint64;
}

/* tslint:disable:no-empty-interface*/
// Empty for Phase 0
export interface CustodyReseed {}
export interface CustodyChallenge {}
export interface CustodyResponse {}
