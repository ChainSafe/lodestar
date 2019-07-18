/**
 * @module types
 */

import {
  BLSSignature,
  BLSPubkey,
  bool,
  bytes,
  bytes4,
  bytes32,
  Epoch,
  Slot,
  ValidatorIndex,
  number64,
  Gwei,
} from "./primitive";

export interface Fork {
  // Previous fork version
  previousVersion: bytes4;
  // Current fork version
  currentVersion: bytes4;
  // Fork epoch number
  epoch: Epoch;
}

export interface Crosslink {
  //Shard number
  shard: number64;
  //Crosslinking data from epochs [start....end-1]
  startEpoch: number64;
  endEpoch: number64;
  //Root of the previous crosslink
  parentRoot: bytes32;
  //Root of the crosslinked shard data since the previous crosslink
  dataRoot: bytes32;
}

export interface Eth1Data {
  // Root of the deposit tree
  depositRoot: bytes32;
  // Total number of deposits
  depositCount: number64;
  // Block hash
  blockHash: bytes32;
}

export interface AttestationData {
  // LMD GHOST vote
  beaconBlockRoot: bytes32;
  // FFG vote
  sourceEpoch: Epoch;
  sourceRoot: bytes32;
  targetEpoch: Epoch;
  targetRoot: bytes32;
  // Crosslink vote
  crosslink: Crosslink;
}

export interface AttestationDataAndCustodyBit {
  // Attestation data
  data: AttestationData;
  // Custody bit
  custodyBit: bool;
}

export interface IndexedAttestation {
  // Validator Indices
  custodyBit0Indices: ValidatorIndex[];
  custodyBit1Indices: ValidatorIndex[];
  // Attestation Data
  data: AttestationData;
  // Aggregate signature
  signature: BLSSignature;
}

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

export interface BeaconBlockHeader {
  slot: Slot;
  parentRoot: bytes32;
  stateRoot: bytes32;
  bodyRoot: bytes32;
  signature: BLSSignature;
}

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

export interface HistoricalBatch {
  // Block roots
  blockRoots: bytes32[];
  // State roots
  stateRoots: bytes32[];
}

export interface FFGData {
  sourceEpoch: Epoch;
  sourceRoot: bytes32;
  targetEpoch: Epoch;
}

export interface MerkleTree {
  depth: number64;
  tree: bytes32[][];
}
