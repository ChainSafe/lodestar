// TODO replace uint, hash32, bytes

// These interfaces relate to the data structures for beacon chain blocks

import {CustodyReseed, CustodyResponse} from "./state";

type bytes = number;
type uint24 = number;
type uint64 = number;
type uint384 = number;
type hash32 = Uint8Array;

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
  slashableVoteData1: SlashableVoteData;
  // Second batch of votes
  slashableVoteData2: SlashableVoteData;
}

export interface SlashableVoteData {
  // Proof-of-custody indices (0 bits)
  custodyBit0Indices: uint24[];
  // Proof-of-custody indices (1 bits)
  custodyBit1Indices: uint24[];
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
  beaconBlockRoot: hash32;
  // Hash of the ancestor at the epoch boundary
  epochBoundaryRoot: hash32;
  // Shard block hash being attested to
  shardBlockRoot: hash32;
  // Last crosslink hash
  latestCrosslinkRoot: hash32;
  // Slot of the last justified beacon block
  justifiedSlot: uint64;
  // Hash of the last justified beacon block
  justifiedBlockRoot: hash32;
}

export interface AttestationDataAndCustodyBit {
  // Attestation data
  data: AttestationData;
  // Custody bit
  custodyBit: boolean;
}

export interface Deposit {
  // Branch in the deposit tree
  branch: hash32[];
  // index in the deposit tree
  index: uint64;
  // Deposit data
  depositData: DepositData;
}

export interface DepositData {
  // Amount in Gwei
  amount: uint64;
  // Timestamp from deposit contract
  timestamp: uint64;
  // Deposit Input
  depositInput: DepositInput;
}

export interface DepositInput {
  // BLS pubkey
  pubkey: uint384;
  // Withdrawal credentials
  withdrawalCredentials: hash32;
  // Initial RANDAO commitment
  randaoCommitment: hash32;
  // Initial custody commitment
  custodyCommitment: hash32;
  // BLS proof of possession (a BLS signature)
  proofOfPossession: uint384[];
}

export interface Exit {
  // Minimum slot for processing exit
  slot: uint64;
  // Index of the exiting validator
  validator_index: uint24;
  // Validator signature
  signature: uint384[];
}

// Beacon chain blocks
export interface BeaconBlock {
  // Header
  slot: uint64;
  parentRoot: hash32;
  stateRoot: hash32;
  randaoReveal: hash32;
  depositRoot: hash32;
  signature: uint384[];

  // Body
  body: BeaconBlockBody;
}

export interface BeaconBlockBody {
  proposerSlashings: ProposerSlashing[];
  casperSlashings: CasperSlashing[];
  attestations: Attestation[];
  custodyReseeds: CustodyReseed[];
  custodyResponses: CustodyResponse[];
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
