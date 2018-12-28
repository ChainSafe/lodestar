// TODO replace uint, hash32, bytes

// These interfaces relate to the data structures for beacon chain state

import { AttestationData } from "./blocks";

type bytes = number;
type uint24 = number;
type uint64 = number;
type uint384 = number;
type hash32 = Uint8Array;

export interface BeaconState {
  slot: uint64;
  genesisTime: uint64;
  // For versioning hard forks
  forkData: ForkData;

  // Validator registry
  validatorRegistry: ValidatorRecord[];
  validatorRegistryLatestChangeSlot: uint64;
  validatorRegistryExitCount: uint64;
  // For light clients to track deltas
  validatorRegistryDeltaChainTip: hash32;

  // Randomness and committees
  randaoMix: hash32;
  nextSeed: hash32;
  shardCommitteesAtSlots: ShardCommittee[][];
  persistentCommittees: uint24[][];
  persistentCommitteeReassignments: ShardReassignmentRecord[];

  // Finality
  previousJustifiedSlot: uint64;
  justifiedSlot: uint64;
  justificationBitfield: uint64;
  finalizedSlot: uint64;

  // Recent state
  latestCrosslinks: CrosslinkRecord[];
  // Needed to process attestations; older to newer
  latestBlockHashes: hash32[];
  // Balances penalized at every withdrawal period
  latestPenalizedExitBalances: uint64[];
  latestAttestations: PendingAttestationRecord[];

  // PoW receipt root
  processedPowReceiptRoot: hash32;
  candidatePowReceiptRoots: CandidatePoWReceiptRootRecord[];
}

export interface ValidatorRecord {
  // BLS public key
  pubkey: uint384;
  // Withdrawal credentials
  withdrawalCredentials: hash32;
  // RANDAO commitment
  randaoCommitment: hash32;
  // Slot the proposer has skipped (ie. layers of RANDAO expected)
  randaoSkips: uint64;
  // Balance in Gwei
  balance: uint64;
  // Status code
  status: uint64;
  // Slot when validator last changed status (or 0)
  lastStatusChangeSlot: uint64;
  // Exit counter when validator exited (or 0)
  exitCount: uint64;
}

export interface CrosslinkRecord {
  // Slot number
  slot: uint64;
  // Shard chain block hash
  shardBlockHash: hash32;
}

export interface ShardCommittee {
  // Shard number
  shard: uint64;
  // Validator indices
  committee: uint24[];
  totalValidatorCount: uint64;
}

export interface ShardReassignmentRecord {
  // Which validator to reassign
  validatorIndex: uint24;
  // To which shard
  shard: uint64;
  // When
  slot: uint64;
}

export interface CandidatePoWReceiptRootRecord {
  // Candidate PoW receipt root
  candidatePowReceiptRoot: hash32;
  // Vote count
  votes: uint64;
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
