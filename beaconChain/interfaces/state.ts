// TODO replace uint, hash32, bytes

// These interfaces relate to the data structures for beacon chain state

import { AttestationRecord } from "./blocks";

type uint24 = number;
type uint64 = number;
type uint384 = number;
type hash32 = number;

export interface BeaconState {
  // Slot of last validator set change
  validatorSetChangeSlot: uint64,
  // List of validators
  validators: ValidatorRecord[],
  // Most recent crosslink for each shard
  crosslinks: CrosslinkRecord[],
  // Last cycle-boundary state recalculation
  lastStateRecalculationSlot: uint64,
  // Last finalized slot
  lastFinalizedSlot: uint64,
  // Last justified slot
  lastJustifiedSlot: uint64,
  // Number of consecutive justified slots
  justifiedStreak: uint64,
  // Committee members and their assigned shard, per slot
  shardAndCommitteeForSlots: ShardAndCommittee[][],
  // Persistent shard committees
  persistentCommittees: uint24[][],
  persistentCommitteeReassignments: ShardReassignmentRecord[],
  // Randao seed used for next shuffling
  nextShufflingSeed: hash32,
  // Total deposits penalized in the given withdrawal period
  depositsPenalizedInPeriod: uint64[],
  // Hash chain of validator set changes (for light clients to easily track deltas)
  validatorSetDeltaHashChain: hash32
  // Current sequence number for withdrawals
  currentExitSeq: uint64,
  // Genesis time
  genesisTime: uint64,
  // PoW receipt root
  processedPowReceiptRoot: hash32,
  candidatePowReceiptRoots: CandidatePoWReceiptRootRecord[],
  // Parameters relevant to hard forks / versioning.
  // Should be updated only by hard forks.
  preForkVersion: uint64,
  postForkVersion: uint64,
  forkSlotNumber: uint64,
  // Attestations not yet processed
  pendingAttestations: AttestationRecord[],
  // recent beacon block hashes needed to process attestations, older to newer
  recentBlockHashes: hash32[],
  // RANDAO state
  randaoMix: hash32
}

export interface  ValidatorRecord {
  // BLS public key
  pubkey: uint384,
  // Withdrawal credentials
  withdrawalCredentials: hash32,
  // RANDAO commitment
  randaoCommitment: hash32,
  // Slot the proposer has skipped (ie. layers of RANDAO expected)
  randaoSkips: uint64,
  // Balance in Gwei
  balance: uint64,
  // Status code
  status: uint64,
  // Slot when validator last changed status (or 0)
  lastStatusChangeSlot: uint64
  // Sequence number when validator exited (or 0)
  exit_seq: uint64
}

export interface CrosslinkRecord {
  // Slot number
  slot: uint64,
  // Shard chain block hash
  shardBlockHash: hash32
}

export interface ShardAndCommittee {
  // Shard number
  shard: uint64,
  // Validator indices
  committee: uint24[]
}

export interface ShardReassignmentRecord {
  // Which validator to reassign
  validatorIndex: uint24,
  // To which shard
  shard: uint64,
  // When
  slot: uint64
}

export interface CandidatePoWReceiptRootRecord {
  // Candidate PoW receipt root
  candidatePowReceiptRoot: hash32,
  // Vote count
  votes: uint64
}
