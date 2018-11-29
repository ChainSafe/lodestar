// TODO replace uint, hash32, bytes

// These interfaces relate to the data structures for beacon chain blocks

export interface BeaconBlock {
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

export interface AttestationRecord {
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

export interface ProposalSignedData {
  // Slot number
  slot: 'uint64',
  // Shard number (or `2**64 - 1` for beacon chain)
  shard: 'uint64',
  // Block hash
  block_hash: 'hash32',
}

export interface AttestationSignedData {
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

export interface SpecialRecord {
  // Kind
  kind: 'uint64',
  // Data
  data: 'bytes'
}
