// TODO replace uint, hash32, bytes
// TODO potentially move these structs somewhere else once I find a home for them

// Interfaces related to beacon chain blocks
interface BeaconBlock {
  // Slot number
  slot: 'uint64',
  // Proposer RANDAO reveal
  randao_reveal: 'hash32',
  // Recent PoW receipt root
  candidate_pow_receipt_root: 'hash32',
  // Skip list of previous beacon block hashes
  // i'th item is the most recent ancestor whose slot is a multiple of 2**i for i = 0, ..., 31
  ancestor_hashes: ['hash32'],
  // State root
  state_root: 'hash32',
  // Attestations
  attestations: AttestationRecord[],
  // Specials (e.g. logouts, penalties)
  specials: SpecialRecord[],
  // Proposer signature
  proposer_signature: 'uint384'[],
}

interface AttestationRecord {
  // Slot number
  slot: 'uint64',
  // Shard number
  shard: 'uint64',
  // Beacon block hashes not part of the current chain, oldest to newest
  oblique_parent_hashes: 'hash32'[],
  // Shard block hash being attested to
  shard_block_hash: 'hash32',
  // Last crosslink hash
  last_crosslink_hash: 'hash32',
  // Root of data between last hash and this one
  shard_block_combined_data_root: 'hash32',
  // Attester participation bitfield (1 bit per attester)
  attester_bitfield: 'bytes',
  // Slot of last justified beacon block
  justified_slot: 'uint64',
  // Hash of last justified beacon block
  justified_block_hash: 'hash32',
  // BLS aggregate signature
  aggregate_sig: 'uint384'[]
}

interface ProposalSignedData {
  // Slot number
  slot: 'uint64',
  // Shard number (or `2**64 - 1` for beacon chain)
  shard: 'uint64',
  // Block hash
  block_hash: 'hash32',
}

interface AttestationSignedData {
  // Slot number
  slot: 'uint64',
  // Shard number
  shard: 'uint64',
  // CYCLE_LENGTH parent hashes
  parent_hashes: 'hash32'[],
  // Shard block hash
  shard_block_hash: 'hash32',
  // Last crosslink hash
  last_crosslink_hash: 'hash32',
  // Root of data between last hash and this one
  shard_block_combined_data_root: 'hash32',
  // Slot of last justified beacon block referenced in the attestation
  justified_slot: 'uint64'
}

interface SpecialRecord {
  // Kind
  kind: 'uint64',
  // Data
  data: 'bytes'
}

// Interfaces related to beacon chain state

interface BeaconState {
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

interface  ValidatorRecord {
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

interface CrosslinkRecord {
  // Slot number
  slot: 'uint64',
  // Shard chain block hash
  shard_block_hash: 'hash32'
}

interface ShardAndCommittee {
  // Shard number
  shard: 'uint64',
  // Validator indices
  committee: 'uint24'[]
}

interface ShardReassignmentRecord {
  // Which validator to reassign
  validator_index: 'uint24',
  // To which shard
  shard: 'uint64',
  // When
  slot: 'uint64'
}

interface CandidatePoWReceiptRootRecord {
  // Candidate PoW receipt root
  candidate_pow_receipt_root: 'hash32',
  // Vote count
  votes: 'uint64'
}
