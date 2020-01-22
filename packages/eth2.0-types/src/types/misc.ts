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
  Root,
  number64,
  Slot,
  ValidatorIndex,
  Version,
  CommitteeIndex,
  bytes32,
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
  root: Root;
}

export interface Validator {
  // BLS public key
  pubkey: BLSPubkey;
  // Commitment to pubkey for withdrawals
  withdrawalCredentials: bytes32;
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
  beaconBlockRoot: Root;
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
  depositRoot: Root;
  // Total number of deposits
  depositCount: number64;
  // Block hash
  blockHash: bytes32;
}

export interface HistoricalBatch {
  // Block roots
  blockRoots: Root[];
  // State roots
  stateRoots: Root[];
}

export interface DepositMessage {
  // BLS pubkey
  pubkey: BLSPubkey;
  // Withdrawal credentials
  withdrawalCredentials: bytes32;
  // Amount in Gwei
  amount: Gwei;
}

export interface DepositData {
  // BLS pubkey
  pubkey: BLSPubkey;
  // Withdrawal credentials
  withdrawalCredentials: bytes32;
  // Amount in Gwei
  amount: Gwei;
  // Signing over DepositMessage
  signature: BLSSignature;
}

export interface BeaconBlockHeader {
  slot: Slot;
  parentRoot: Root;
  stateRoot: Root;
  bodyRoot: Root;
}

export interface SignedBeaconBlockHeader {
  message: BeaconBlockHeader;
  signature: BLSSignature;
}

export interface FFGData {
  source: Checkpoint;
  target: Checkpoint;
}

export interface MerkleTree {
  depth: number64;
  tree: bytes32[][];
}
