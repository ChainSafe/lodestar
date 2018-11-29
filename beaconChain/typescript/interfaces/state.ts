// TODO replace uint, hash32, bytes

// These interfaces relate to the data structures for beacon chain state

import { AttestationRecord } from "./blocks";

export interface BeaconState {
  // Slot of last validator set change
  validator_set_change_slot: 'uint64',
  // List of validators
  validators: ValidatorRecord[],
  // Most recent crosslink for each shard
  crosslinks: CrosslinkRecord[],
  // Last cycle-boundary state recalculation
  last_state_recalculation_slot: 'uint64',
  // Last finalized slot
  last_finalized_slot: 'uint64',
  // Last justified slot
  last_justified_slot: 'uint64',
  // Number of consecutive justified slots
  justified_streak: 'uint64',
  // Committee members and their assigned shard, per slot
  shard_and_committee_for_slots: [[ShardAndCommittee]],
  // Persistent shard committees
  persistent_committees: [['uint24']],
  persistent_committee_reassignments: ShardReassignmentRecord[],
  // Randao seed used for next shuffling
  next_shuffling_seed: 'hash32',
  // Total deposits penalized in the given withdrawal period
  deposits_penalized_in_period: 'uint64'[],
  // Hash chain of validator set changes (for light clients to easily track deltas)
  validator_set_delta_hash_chain: 'hash32'
  // Current sequence number for withdrawals
  current_exit_seq: 'uint64',
  // Genesis time
  genesis_time: 'uint64',
  // PoW receipt root
  processed_pow_receipt_root: 'hash32',
  candidate_pow_receipt_roots: CandidatePoWReceiptRootRecord[],
  // Parameters relevant to hard forks / versioning.
  // Should be updated only by hard forks.
  pre_fork_version: 'uint64',
  post_fork_version: 'uint64',
  fork_slot_number: 'uint64',
  // Attestations not yet processed
  pending_attestations: AttestationRecord[],
  // recent beacon block hashes needed to process attestations, older to newer
  recent_block_hashes: 'hash32'[],
  // RANDAO state
  randao_mix: 'hash32'
}

export interface  ValidatorRecord {
  // BLS public key
  pubkey: 'uint384',
  // Withdrawal credentials
  withdrawal_credentials: 'hash32',
  // RANDAO commitment
  randao_commitment: 'hash32',
  // Slot the proposer has skipped (ie. layers of RANDAO expected)
  randao_skips: 'uint64',
  // Balance in Gwei
  balance: 'uint64',
  // Status code
  status: 'uint64',
  // Slot when validator last changed status (or 0)
  last_status_change_slot: 'uint64'
  // Sequence number when validator exited (or 0)
  exit_seq: 'uint64'
}

export interface CrosslinkRecord {
  // Slot number
  slot: 'uint64',
  // Shard chain block hash
  shard_block_hash: 'hash32'
}

export interface ShardAndCommittee {
  // Shard number
  shard: 'uint64',
  // Validator indices
  committee: 'uint24'[]
}

export interface ShardReassignmentRecord {
  // Which validator to reassign
  validator_index: 'uint24',
  // To which shard
  shard: 'uint64',
  // When
  slot: 'uint64'
}

export interface CandidatePoWReceiptRootRecord {
  // Candidate PoW receipt root
  candidate_pow_receipt_root: 'hash32',
  // Vote count
  votes: 'uint64'
}
