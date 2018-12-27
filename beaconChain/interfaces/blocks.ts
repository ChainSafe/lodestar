//Lodestar Chain
//Copyright (C) 2018 ChainSafe Systems

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// TODO replace uint, hash32, bytes

// These interfaces relate to the data structures for beacon chain blocks

type bytes = number;
type uint24 = number;
type uint64 = number;
type uint384 = number;
type hash32 = number;

// Beacon chain operations

export interface ProposerSlashing {
  // Proposer index
  proposerIndex: uint24;
  // First proposal data
  proposalData1: ProposalSignedData;
  // First proposal signature
  proposalSignature1: uint384[];
  // Second proposal data
  proposalData2: ProposalSignedData;
  // Second proposal signature
  proposalSignature2: uint384[];
}

export interface CasperSlashing {
  // First batch of votes
  votes1: SlashableVoteData;
  // Second batch of votes
  votes2: SlashableVoteData;
}

export interface SlashableVoteData {
  // Proof-of-custody indices (0 bits)
  aggregateSignaturePoc0Indices: uint24[];
  // Proof-of-custody indices (1 bits)
  aggregateSignaturePoc1Indices: uint24[];
  // Attestation data
  data: AttestationData;
  // Aggregate signature
  aggregateSignature: uint384[];
}

export interface Attestation {
  // Attestation data
  data: AttestationData;
  // Attester participation bitfield
  participationBitfield: bytes;
  // Proof of custody bitfield
  custodyBitfield: bytes;
  // BLS aggregate signature
  aggregateSignature: uint384[];
}

export interface AttestationData {
  // Slot number
  slot: uint64;
  // Shard number
  shard: uint64;
  // Hash of the signed beacon block
  beaconBlockHash: hash32;
  // Hash of the ancestor at the epoch boundary
  epochBoundaryHash: hash32;
  // Shard block hash being attested to
  shardBlockHash: hash32;
  // Last crosslink hash
  latestCrosslinkHash: hash32;
  // Slot of the last justified beacon block
  justifiedSlot: uint64;
  // Hash of the last justified beacon block
  justifiedBlockHash: hash32;
}

export interface Deposit {
  // Receipt Merkle branch
  merkleBranch: hash32[];
  // Merkle tree index
  merkleTreeIndex: uint64;
  // Deposit data
  depositData: DepositData;
}

export interface DepositData {
  // Deposit parameters
  depositParameters: DepositParameters;
  // Value in Gwei
  value: uint64;
  // Timestamp from deposit contract
  timestamp: uint64;
}

export interface DepositParameters {
  // BLS pubkey
  pubkey: uint384;
  // BLS proof of possession (a BLS signature)
  proofOfPossession: uint384[];
  // Withdrawal credentials
  withdrawalCredentials: hash32;
  // Initial RANDAO commitment
  randaoCommitment: hash32;
}

export interface Exit {
  // Minimum slot for processing exit
  slot: uint64;
  // Index of the exiting validator
  validator_index: uint64;
  // Validator signature
  signature: uint384[];
}

// Beacon chain blocks

export interface BeaconBlock {
  // Slot number
  slot: uint64;
  // Skip list of previous beacon block hashes
  // i'th item is the most recent ancestor whose slot is a multiple of 2**i for i = 0, ..., 31
  ancestorHashes: hash32[];
  // State root
  stateRoot: hash32;
  // Proposer RANDAO reveal
  randaoReveal: hash32;
  // Recent PoW receipt root
  candidatePowReceiptRoot: hash32;
  // Proposer signature
  signature: uint384[];

  // Body
  body: BeaconBlockBody;
}

export interface BeaconBlockBody {
  attestations: Attestation[];
  proposerSlashings: ProposerSlashing[];
  casperSlashings: CasperSlashing[];
  deposits: Deposit[];
  exits: Exit[];
}

export interface ProposalSignedData {
  // Slot number
  slot: uint64;
  // Shard number (`BEACON_CHAIN_SHARD_NUMBER` for beacon chain)
  shard: uint64;
  // Block hash
  blockHash: hash32;
}
