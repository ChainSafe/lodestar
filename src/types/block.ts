import {SimpleContainerType} from "@chainsafe/ssz";
// Each type exported here contains both a compile-time type (a typescript interface) and a run-time type (a javascript variable)
// For more information, see ./index.ts

// These interfaces relate to the data structures for beacon chain blocks

import {
  bytes32,
  bytes48,
  bytes96,
  uint64,
  number64,
} from "./primitive";

import {
  Shard,
  Slot,
  ValidatorIndex,
  Epoch,
} from "./custom";

import {
  Attestation,
  AttesterSlashing,
} from "./attestation";

import {
  Eth1Data,
} from "./eth1";

export interface ProposalSignedData {
  // Slot number
  slot: Slot;
  // Shard number (`BEACON_CHAIN_SHARD_NUMBER` for beacon chain)
  shard: Shard;
  // Block root
  blockRoot: bytes32;
}
export const ProposalSignedData: SimpleContainerType = {
  name: "ProposalSignedData",
  fields: [
    ["slot", Slot],
    ["shard", Shard],
    ["blockRoot", bytes32],
  ],
};

export interface ProposerSlashing {
  // Proposer index
  proposerIndex: ValidatorIndex;
  // First proposal data
  proposalData1: ProposalSignedData;
  // First proposal signature
  proposalSignature1: bytes96;
  // Second proposal data
  proposalData2: ProposalSignedData;
  // Second proposal signature
  proposalSignature2: bytes96;
}
export const ProposerSlashing: SimpleContainerType = {
  name: "ProposerSlashing",
  fields: [
    ["proposerIndex", ValidatorIndex],
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
export const DepositInput: SimpleContainerType = {
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
  timestamp: number64;
  // Deposit Input
  depositInput: DepositInput;
}
export const DepositData: SimpleContainerType = {
  name: "DepositData",
  fields: [
    ["amount", uint64],
    ["timestamp", number64],
    ["depositInput", DepositInput],
  ],
};

export interface Deposit {
  // Branch in the deposit tree
  branch: bytes32[];
  // index in the deposit tree
  index: number64;
  // Deposit data
  depositData: DepositData;
}
export const Deposit: SimpleContainerType = {
  name: "Deposit",
  fields: [
    ["branch", [bytes32]],
    ["index", number64],
    ["depositData", DepositData],
  ],
};

export interface VoluntaryExit {
  // Minimum slot for processing exit
  epoch: Epoch;
  // Index of the exiting validator
  validatorIndex: ValidatorIndex;
  // Validator signature
  signature: bytes96;
}
export const VoluntaryExit: SimpleContainerType = {
  name: "VoluntaryExit",
  fields: [
    ["epoch", Epoch],
    ["validatorIndex", ValidatorIndex],
    ["signature", bytes96],
  ],
};

export interface Transfer {
  // Sender index
  from: ValidatorIndex;
  // Recipient index
  to: ValidatorIndex;
  // Amount in Gwei
  amount: uint64;
  // Fee in Gwei for block proposer
  fee: uint64;
  // Inclusion slot
  slot: Slot;
  // Sender withdrawal pubkey
  pubkey: bytes48;
  // Sender signature
  signature: bytes96;
}

export const Transfer: SimpleContainerType = {
  name: "Transfer",
  fields: [
    ["from", ValidatorIndex],
    ["to", ValidatorIndex],
    ["amount", uint64],
    ["fee", uint64],
    ["slot", Slot],
    ["pubkey", bytes48],
    ["signature", bytes96],
  ],
};

export interface BeaconBlockBody {
  proposerSlashings: ProposerSlashing[];
  attesterSlashings: AttesterSlashing[];
  attestations: Attestation[];
  deposits: Deposit[];
  voluntaryExits: VoluntaryExit[];
  transfers: Transfer[];
}
export const BeaconBlockBody: SimpleContainerType = {
  name: "BeaconBlockBody",
  fields: [
    ["proposerSlashings", [ProposerSlashing]],
    ["attesterSlashings", [AttesterSlashing]],
    ["attestations", [Attestation]],
    ["deposits", [Deposit]],
    ["voluntaryExits", [VoluntaryExit]],
    ["transfers", [Transfer]],
  ],
};

export interface BeaconBlock {
  // Header
  slot: Slot;
  parentRoot: bytes32;
  stateRoot: bytes32;
  randaoReveal: bytes96;
  eth1Data: Eth1Data;
  signature: bytes96;

  // Body
  body: BeaconBlockBody;
}
export const BeaconBlock: SimpleContainerType = {
  name: "BeaconBlock",
  fields: [
    ["slot", Slot],
    ["parentRoot", bytes32],
    ["stateRoot", bytes32],
    ["randaoReveal", bytes96],
    ["eth1Data", Eth1Data],
    ["signature", bytes96],
    ["body", BeaconBlockBody],
  ],
};

export interface CrosslinkCommittee {
  shard: Shard;
  validatorIndices: ValidatorIndex[];
}
export const CrosslinkCommittee: SimpleContainerType = {
  name: "CrosslinkCommittee",
  fields: [
    ["shard", Shard],
    ["validatorIndices", [ValidatorIndex]],
  ],
};
