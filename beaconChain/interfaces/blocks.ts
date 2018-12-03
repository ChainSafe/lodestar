// TODO replace uint, hash32, bytes

// These interfaces relate to the data structures for beacon chain blocks

type bytes = number;
type uint64 = number;
type uint384 = number;
type hash32 = number;

export interface BeaconBlock {
  // Slot number
  slot: uint64,
  // Proposer RANDAO reveal
  randaoReveal: hash32,
  // Recent PoW receipt root
  candidatePowReceiptRoot: hash32,
  // Skip list of previous beacon block hashes
  // i'th item is the most recent ancestor whose slot is a multiple of 2**i for i = 0, ..., 31
  ancestorHashes: hash32[],
  // State root
  stateRoot: hash32,
  // Attestations
  attestations: AttestationRecord[],
  // Specials (e.g. logouts, penalties)
  specials: SpecialRecord[],
  // Proposer signature
  proposerSignature: uint384[],
}

export interface AttestationRecord {
  // Slot number
  slot: uint64,
  // Shard number
  shard: uint64,
  // Beacon block hashes not part of the current chain, oldest to newest
  obliqueParentHashes: hash32[],
  // Shard block hash being attested to
  shardBlockHash: hash32,
  // Last crosslink hash
  lastCrosslinkHash: hash32,
  // Root of data between last hash and this one
  shardBlockCombinedDataRoot: hash32,
  // Attester participation bitfield (1 bit per attester)
  attesterBitfield: bytes,
  // Slot of last justified beacon block
  justifiedSlot: uint64,
  // Hash of last justified beacon block
  justifiedBlockHash: hash32,
  // BLS aggregate signature
  aggregateSig: uint384[]
}

export interface ProposalSignedData {
  // Slot number
  slot: uint64,
  // Shard number (or `2**64 - 1` for beacon chain)
  shard: uint64,
  // Block hash
  blockHash: hash32,
}

export interface AttestationSignedData {
  // Slot number
  slot: uint64,
  // Shard number
  shard: uint64,
  // CYCLE_LENGTH parent hashes
  parentHashes: hash32[],
  // Shard block hash
  shardBlockHash: hash32,
  // Last crosslink hash
  lastCrosslinkHash: hash32,
  // Root of data between last hash and this one
  shardBlockCombinedDataRoot: hash32,
  // Slot of last justified beacon block referenced in the attestation
  justifiedSlot: uint64
}

export interface SpecialRecord {
  // Kind
  kind: uint64,
  // Data
  data: bytes
}
