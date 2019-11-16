/* eslint-disable @typescript-eslint/interface-name-prefix */
/**
 * @module types
 */

import {BitList} from "@chainsafe/bit-utils";

import {
  BLSPubkey,
  BLSSignature,
  bool,
  Epoch,
  Gwei,
  Hash,
  number64,
  Slot,
  ValidatorIndex,
  Version,
  CommitteeIndex,
} from "./primitive";

export interface Fork {
  // Previous fork version
  previousVersion: Version;
  // Current fork version
  currentVersion: Version;
  // Fork epoch number
  epoch: Epoch;
}

export interface Checkpoint {
  epoch: Epoch;
  root: Hash;
}

export interface Validator {
  // BLS public key
  pubkey: BLSPubkey;
  // Commitment to pubkey for withdrawals
  withdrawalCredentials: Hash;
  // Balance at stake
  effectiveBalance: Gwei;
  // Was the validator slashed
  slashed: bool;
  // When criteria for activation were met
  activationEligibilityEpoch: Epoch;
  // Epoch when validator activated
  activationEpoch: Epoch;
  // Epoch when validator exited
  exitEpoch: Epoch;
  // When validator can withdraw or transfer funds
  withdrawableEpoch: Epoch;
}

export interface AttestationData {
  slot: Slot;
  index: CommitteeIndex;
  // LMD GHOST vote
  beaconBlockRoot: Hash;
  // FFG vote
  source: Checkpoint;
  target: Checkpoint;
}

export interface IndexedAttestation {
  // Validator Indices
  attestingIndices: ValidatorIndex[];
  // Attestation Data
  data: AttestationData;
  // Aggregate signature
  signature: BLSSignature;
}

export interface PendingAttestation {
  // Attester aggregation bitfield
  aggregationBits: BitList;
  // Attestation data
  data: AttestationData;
  // Inclusion delay
  inclusionDelay: Slot;
  // Proposer index
  proposerIndex: ValidatorIndex;
}

export interface Eth1Data {
  // Root of the deposit tree
  depositRoot: Hash;
  // Total number of deposits
  depositCount: number64;
  // Block hash
  blockHash: Hash;
}

export interface HistoricalBatch {
  // Block roots
  blockRoots: Hash[];
  // State roots
  stateRoots: Hash[];
}

export interface DepositData {
  // BLS pubkey
  pubkey: BLSPubkey;
  // Withdrawal credentials
  withdrawalCredentials: Hash;
  // Amount in Gwei
  amount: Gwei;
  // Container self-signature
  signature: BLSSignature;
}

export interface BeaconBlockHeader {
  slot: Slot;
  parentRoot: Hash;
  stateRoot: Hash;
  bodyRoot: Hash;
  signature: BLSSignature;
}

export interface FFGData {
  source: Checkpoint;
  target: Checkpoint;
}

export interface MerkleTree {
  depth: number64;
  tree: Hash[][];
}
