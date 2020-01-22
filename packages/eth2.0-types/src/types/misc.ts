/* eslint-disable @typescript-eslint/interface-name-prefix */
/**
 * @module types
 */

import {BitList, List, Vector} from "@chainsafe/ssz";

import {
  BLSPubkey,
  BLSSignature,
  Epoch,
  Gwei,
  Root,
  Number64,
  Slot,
  ValidatorIndex,
  Version,
  CommitteeIndex,
  Bytes32,
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
  withdrawalCredentials: Bytes32;
  // Balance at stake
  effectiveBalance: Gwei;
  // Was the validator slashed
  slashed: boolean;
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
  attestingIndices: List<ValidatorIndex>;
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
  depositCount: Number64;
  // Block hash
  blockHash: Bytes32;
}

export interface HistoricalBatch {
  // Block roots
  blockRoots: Vector<Root>;
  // State roots
  stateRoots: Vector<Root>;
}

export interface DepositMessage {
  // BLS pubkey
  pubkey: BLSPubkey;
  // Withdrawal credentials
  withdrawalCredentials: Bytes32;
  // Amount in Gwei
  amount: Gwei;
}

export interface DepositData {
  // BLS pubkey
  pubkey: BLSPubkey;
  // Withdrawal credentials
  withdrawalCredentials: Bytes32;
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

export interface MerkleTree {
  depth: Number64;
  tree: List<List<Bytes32>>;
}
