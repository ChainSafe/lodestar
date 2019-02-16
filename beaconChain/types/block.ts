// Each type exported here contains both a compile-time type (a typescript interface) and a run-time type (a javascript variable)
// For more information, see ./index.ts

// These interfaces relate to the data structures for beacon chain blocks

import {
  bool,
  bytes,
  bytes32,
  bytes48,
  bytes96,
  uint24,
  uint384,
  uint64,
} from "./primitive";

import {
  Attestation,
  AttesterSlashings,
} from "./attestation";

import {
  Eth1Data,
} from "./eth1";

export interface ProposalSignedData {
  // Slot number
  slot: uint64;
  // Shard number (`BEACON_CHAIN_SHARD_NUMBER` for beacon chain)
  shard: uint64;
  // Block root
  blockRoot: bytes32;
}
export const ProposalSignedData = {
  name: "ProposalSignedData",
  fields: [
    ["slot", uint64],
    ["shard", uint64],
    ["blockRoot", bytes32],
  ],
};

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
export const ProposerSlashing = {
  name: "ProposerSlashing",
  fields: [
    ["proposerIndex", uint64],
    ["proposalData1", ProposalSignedData],
    ["proposalSignature1", bytes96],
    ["proposalData2", ProposalSignedData],
    ["proposalSignature2", bytes96],
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
export const DepositInput = {
  name: "DepositInput",
  fields: [
    ["pubkey", bytes48],
    ["withdrawalCredentials", bytes32],
    ["proofOfPossession", bytes96],
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
export const DepositData = {
  name: "DepositData",
  fields: [
    ["amount", uint64],
    ["timestamp", uint64],
    ["depositInput", DepositInput],
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
export const Deposit = {
  name: "Deposit",
  fields: [
    ["branch", [bytes32]],
    ["index", uint64],
    ["depositData", DepositData],
  ],
};

export interface VoluntaryExit {
  // Minimum slot for processing exit
  epoch: uint64;
  // Index of the exiting validator
  validator_index: uint64;
  // Validator signature
  signature: bytes96;
}
export const VoluntaryExit = {
  name: "VoluntaryExit",
  fields: [
    ["epoch", uint64],
    ["validator_index", uint64],
    ["signature", bytes96],
  ],
};

export interface Transfer {
    // Sender index
    from: uint64;
    // Recipient index
    to: uint64;
    // Amount in Gwei
    amount: uint64;
    // Fee in Gwei for block proposer
    fee: uint64;
    // Inclusion slot
    slot: uint64;
    // Sender withdrawal pubkey
    pubkey: bytes48;
    // Sender signature
    signature: bytes96;
}

export const Transfer = {
  name: "Transfer",
  fields: [
      ["from", uint64],
      ["to", uint64],
      ["amount", uint64],
      ["fee", uint64],
      ["slot", uint64],
      ["pubkey", bytes48],
      ["signature", bytes96],
  ],
};

export interface BeaconBlockBody {
  proposerSlashings: ProposerSlashing[];
  casperSlashings: AttesterSlashings[];
  attestations: Attestation[];
  deposits: Deposit[];
  exits: VoluntaryExit[];
  transfers: Transfer[];
}
export const BeaconBlockBody = {
  name: "BeaconBlockBody",
  fields: [
    ["proposerSlashings", [ProposerSlashing]],
    ["casperSlashings", [AttesterSlashings]],
    ["attestations", [Attestation]],
    ["deposits", [Deposit]],
    ["exits", [VoluntaryExit]],
    ["transfers", [Transfer]],
  ],
};

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
export const BeaconBlock = {
  name: "BeaconBlock",
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

