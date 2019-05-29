/**
 * @module types
 */

// Each type exported here contains both a compile-time type
// (a typescript interface) and a run-time ssz type (a javascript variable)
// For more information, see ./index.ts
import {SimpleContainerType} from "@chainsafe/ssz";

import {
  BLSSignature,
  BLSPubkey,
  bool,
  bytes,
  bytes4,
  bytes32,
  Epoch,
  Shard,
  Slot,
  ValidatorIndex,
  number64,
  Gwei,
} from "./primitive";

import {SLOTS_PER_HISTORICAL_ROOT} from "../constants";

export interface Fork {
  // Previous fork version
  previousVersion: bytes4;
  // Current fork version
  currentVersion: bytes4;
  // Fork epoch number
  epoch: Epoch;
}
export const Fork: SimpleContainerType = {
  name: "Fork",
  fields: [
    ["previousVersion", bytes4],
    ["currentVersion", bytes4],
    ["epoch", Epoch],
  ],
};

export interface Crosslink {
  // Epoch number
  epoch: Epoch;
  // Root of the previous crosslink
  previousCrosslinkRoot: bytes32;
  // Root of the crosslinked shard data since the previous crosslink
  crosslinkDataRoot: bytes32;
}

export const Crosslink: SimpleContainerType = {
  name: "Crosslink",
  fields: [
    ["epoch", Epoch],
    ["previousCrosslinkRoot", bytes32],
    ["crosslinkDataRoot", bytes32],
  ],
};

export interface Eth1Data {
  // Root of the deposit tree
  depositRoot: bytes32;
  // Total number of deposits
  depositCount: number64;
  // Block hash
  blockHash: bytes32;
}
export const Eth1Data: SimpleContainerType = {
  name: "Eth1Data",
  fields: [
    ["depositRoot", bytes32],
    ["depositCount", number64],
    ["blockHash", bytes32],
  ],
};

export interface AttestationData {
  // LMD GHOST vote
  beaconBlockRoot: bytes32;
  // FFG vote
  sourceEpoch: Epoch;
  sourceRoot: bytes32;
  targetEpoch: Epoch;
  targetRoot: bytes32;
  // Crosslink vote
  shard: Shard;
  previousCrosslinkRoot: bytes32;
  crosslinkDataRoot: bytes32;
}
export const AttestationData: SimpleContainerType = {
  name: "AttestationData",
  fields: [
    ["beaconBlockRoot", bytes32],
    ["sourceEpoch", Epoch],
    ["sourceRoot", bytes32],
    ["targetEpoch", Epoch],
    ["targetRoot", bytes32],
    ["shard", Shard],
    ["previousCrosslinkRoot", bytes32],
    ["crosslinkDataRoot", bytes32],
  ],
};

export interface AttestationDataAndCustodyBit {
  // Attestation data
  data: AttestationData;
  // Custody bit
  custodyBit: bool;
}
export const AttestationDataAndCustodyBit: SimpleContainerType = {
  name: "AttestationDataAndCustodyBit",
  fields: [
    ["data", AttestationData],
    ["custodyBit", bool],
  ],
};

export interface IndexedAttestation {
  // Validator Indices
  custodyBit0Indices: ValidatorIndex[];
  custodyBit1Indices: ValidatorIndex[];
  // Attestation Data
  data: AttestationData;
  // Aggregate signature
  signature: BLSSignature;
}
export const IndexedAttestation: SimpleContainerType = {
  name: "IndexedAttestation",
  fields: [
    ["custodyBit0Indices", [ValidatorIndex]],
    ["custodyBit1Indices", [ValidatorIndex]],
    ["data", AttestationData],
    ["signature", BLSSignature],
  ],
};

export interface DepositData {
  // BLS pubkey
  pubkey: BLSPubkey;
  // Withdrawal credentials
  withdrawalCredentials: bytes32;
  // Amount in Gwei
  amount: Gwei;
  // Container self-signature
  signature: BLSSignature;
}
export const DepositData: SimpleContainerType = {
  name: "DepositData",
  fields: [
    ["pubkey", BLSPubkey],
    ["withdrawalCredentials", bytes32],
    ["amount", Gwei],
    ["signature", BLSSignature],
  ],
};

export interface BeaconBlockHeader {
  slot: Slot;
  previousBlockRoot: bytes32;
  stateRoot: bytes32;
  blockBodyRoot: bytes32;
  signature: BLSSignature;
}
export const BeaconBlockHeader: SimpleContainerType = {
  name: "BeaconBlockHeader",
  fields: [
    ["slot", Slot],
    ["previousBlockRoot", bytes32],
    ["stateRoot", bytes32],
    ["blockBodyRoot", bytes32],
    ["signature", BLSSignature],
  ],
};

export interface Validator {
  // BLS public key
  pubkey: BLSPubkey;
  // Withdrawal credentials
  withdrawalCredentials: bytes32;
  // Epoch when became eligible for activation
  activationEligibilityEpoch: Epoch;
  // Epoch when validator activated
  activationEpoch: Epoch;
  // Epoch when validator exited
  exitEpoch: Epoch;
  // Epoch when validator is eligible to withdraw
  withdrawableEpoch: Epoch;
  // Was the validator slashed
  slashed: bool;
  // Rounded balance
  effectiveBalance: Gwei;
}
export const Validator: SimpleContainerType = {
  name: "Validator",
  fields: [
    ["pubkey", BLSPubkey],
    ["withdrawalCredentials", bytes32],
    ["activationEligibilityEpoch", Epoch],
    ["activationEpoch", Epoch],
    ["exitEpoch", Epoch],
    ["withdrawableEpoch", Epoch],
    ["slashed", bool],
    ["effectiveBalance", Gwei],
  ],
};

export interface PendingAttestation {
  // Attester aggregation bitfield
  aggregationBitfield: bytes;
  // Attestation data
  data: AttestationData;
  // Inclusion delay
  inclusionDelay: number64;
  // Proposer index
  proposerIndex: ValidatorIndex;
}
export const PendingAttestation: SimpleContainerType = {
  name: "PendingAttestation",
  fields: [
    ["aggregationBitfield", bytes],
    ["data", AttestationData],
    ["inclusionDelay", number64],
    ["proposerIndex", ValidatorIndex],
  ],
};

export interface HistoricalBatch {
  // Block roots
  blockRoots: bytes32[];
  // State roots
  stateRoots: bytes32[];
}
export const HistoricalBatch: SimpleContainerType = {
  name: "HistoricalBatch",
  fields: [
    ["blockRoots", [bytes32, SLOTS_PER_HISTORICAL_ROOT]],
    ["stateRoots", [bytes32, SLOTS_PER_HISTORICAL_ROOT]],
  ],
};

