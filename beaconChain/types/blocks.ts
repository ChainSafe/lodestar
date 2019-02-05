/* tslint:disable:no-var-keyword */
// TODO replace uint, hash32, bytes

// Each type exported here contains both a compile-time type (a typescript interface) and a run-time type (a javascript variable)
// For more information, see ./index.ts

// These interfaces relate to the data structures for beacon chain blocks

import { Eth1Data } from "./state";

type bytes = Uint8Array;
type bytes32 = Uint8Array;
type bytes48 = Uint8Array;
type bytes96 = Uint8Array;
type uint24 = number;
type uint64 = number;
type uint384 = number;
type hash32 = Uint8Array;

const bytes = "bytes";
const bytes32 = "bytes32";
const bytes48 = "bytes48";
const bytes96 = "bytes96";
const uint24 = "uint24";
const uint64 = "uint64";
const uint384 = "uint384";

// Beacon chain operations

export interface ProposerSlashing {
  // Proposer index
  proposerIndex: uint64;
  // First proposal data
  proposalData1: ProposalSignedData;
  // First proposal signature
  proposalSignature1: bytes96;
  // Second proposal data
  proposalData2: ProposalSignedData;
  // Second proposal signature
  proposalSignature2: bytes96;
}
export var ProposerSlashing = {
  fields: [
    ["proposerIndex", uint24],
    ["proposalData1", ProposalSignedData],
    ["proposalSignature1", bytes96],
    ["proposalData2", ProposalSignedData],
    ["proposalSignature2", bytes96],
  ],
};

export interface AttesterSlashings {
  // First batch of votes
  slashableVoteData1: SlashableAttestation;
  // Second batch of votes
  slashableVoteData2: SlashableAttestation;
}
export var AttesterSlashings = {
  fields: [
    ["slashableVoteData1", SlashableAttestation],
    ["slashableVoteData2", SlashableAttestation],
  ],
};

export interface SlashableAttestation {
  // Validator Indices
  validatorIndices: uint64[];
  // Attestation Data
  data: AttestationData;
  // Custody Bitfield
  custodyBitfield: bytes;
  // Aggregate signature
  aggregateSignature: bytes96;
}
export var SlashableAttestation = {
  fields: [
    ["validatorIndices", [uint64]],
    ["data", AttestationData],
    ["custodyBitfield", bytes],
    ["aggregateSignature", bytes96],
  ],
};

export interface Attestation {
  // Attestation data
  data: AttestationData;
  // Attester participation bitfield
  aggregationBitfield: bytes;
  // Proof of custody bitfield
  custodyBitfield: bytes;
  // BLS aggregate signature
  aggregateSignature: bytes96;
}
export var Attestation = {
  fields: [
    ["data", AttestationData],
    ["participationBitfield", bytes],
    ["custodyBitfield", bytes],
    ["aggregateSignature", bytes96],
  ],
};

export interface AttestationData {
  // Slot number
  slot: uint64;
  // Shard number
  shard: uint64;
  // Hash of the signed beacon block
  beaconBlockRoot: bytes32;
  // Hash of the ancestor at the epoch boundary
  epochBoundaryRoot: bytes32;
  // Shard block hash being attested to
  shardBlockRoot: bytes32;
  // Last crosslink hash
  latestCrosslinkRoot: bytes32;
  // Slot of the last justified beacon block
  justifiedEpoch: uint64;
  // Hash of the last justified beacon block
  justifiedBlockRoot: bytes32;
}
export var AttestationData = {
  fields: [
    ["slot", uint64],
    ["shard", uint64],
    ["beaconBlockRoot", bytes32],
    ["epochBoundaryRoot", bytes32],
    ["shardBlockRoot", bytes32],
    ["latestCrosslinkRoot", bytes32],
    ["justifiedEpoch", uint64],
    ["justifiedBlockRoot", bytes32],
  ],
};

export interface AttestationDataAndCustodyBit {
  // Attestation data
  data: AttestationData;
  // Custody bit
  custodyBit: boolean;
}
export var AttestationDataAndCustodyBit = {
  fields: [
    ["data", AttestationData],
    ["custodyBit", "bool"],
  ],
};

export interface Deposit {
  // Branch in the deposit tree
  branch: bytes32[];
  // index in the deposit tree
  index: uint64;
  // Deposit data
  depositData: DepositData;
}
export var Deposit = {
  fields: [
    ["branch", [bytes32]],
    ["index", uint64],
    ["depositData", DepositData],
  ],
};

export interface DepositData {
  // Amount in Gwei
  amount: uint64;
  // Timestamp from deposit contract
  timestamp: uint64;
  // Deposit Input
  depositInput: DepositInput;
}
export var DepositData = {
  fields: [
    ["amount", uint64],
    ["timestamp", uint64],
    ["depositInput", DepositInput],
  ],
};

export interface DepositInput {
  // BLS pubkey
  pubkey: bytes48;
  // Withdrawal credentials
  withdrawalCredentials: bytes32;
  // BLS proof of possession (a BLS signature)
  proofOfPossession: bytes96;
}
export var DepositInput = {
  fields: [
    ["pubkey", bytes48],
    ["withdrawalCredentials", bytes32],
    ["proofOfPossession", bytes96],
  ],
};

export interface Exit {
  // Minimum slot for processing exit
  epoch: uint64;
  // Index of the exiting validator
  validator_index: uint64;
  // Validator signature
  signature: bytes96;
}
export var Exit = {
  fields: [
    ["epoch", uint64],
    ["validator_index", uint64],
    ["signature", bytes96],
  ],
};

// Beacon chain blocks
export interface BeaconBlock {
  // Header
  slot: uint64;
  parentRoot: bytes32;
  stateRoot: bytes32;
  randaoReveal: bytes96;
  eth1Data: Eth1Data;
  signature: bytes96;

  // Body
  body: BeaconBlockBody;
}
export var BeaconBlock = {
  fields: [
    ["slot", uint64],
    ["parentRoot", bytes32],
    ["stateRoot", bytes32],
    ["randaoReveal", bytes96],
    ["eth1Data", Eth1Data],
    ["signature", bytes96],
    ["body", BeaconBlockBody],
  ],
};

export interface BeaconBlockBody {
  proposerSlashings: ProposerSlashing[];
  casperSlashings: AttesterSlashings[];
  attestations: Attestation[];
  deposits: Deposit[];
  exits: Exit[];
}
export var BeaconBlockBody = {
  fields: [
    ["proposerSlashings", [ProposerSlashing]],
    ["casperSlashings", [AttesterSlashings]],
    ["attestations", [Attestation]],
    ["deposits", [Deposit]],
    ["exits", [Exit]],
  ],
};

export interface ProposalSignedData {
  // Slot number
  slot: uint64;
  // Shard number (`BEACON_CHAIN_SHARD_NUMBER` for beacon chain)
  shard: uint64;
  // Block root
  blockRoot: bytes32;
}
export var ProposalSignedData = {
  fields: [
    ["slot", uint64],
    ["shard", uint64],
    ["blockRoot", bytes32],
  ],
};
