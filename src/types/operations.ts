/**
 * @module types
 */

import {
  bytes,
  bytes32,
  number64,
  Epoch,
  Slot,
  ValidatorIndex,
  BLSSignature,
  Gwei,
  BLSPubkey,
} from "./primitive";

import {
  AttestationData,
  BeaconBlockHeader,
  DepositData,
  IndexedAttestation,
} from "./misc";


export interface ProposerSlashing {
  // Proposer index
  proposerIndex: ValidatorIndex;
  // First block header
  header1: BeaconBlockHeader;
  // Second block header
  header2: BeaconBlockHeader;
}

export interface AttesterSlashing {
  // First attestation
  attestation1: IndexedAttestation;
  // Second attestation
  attestation2: IndexedAttestation;
}

export interface Attestation {
  // Attester participation bitfield
  aggregationBitfield: bytes;
  // Attestation data
  data: AttestationData;
  // Proof of custody bitfield
  custodyBitfield: bytes;
  // BLS aggregate signature
  signature: BLSSignature;
}

export interface Deposit {
  // Branch in the deposit tree
  proof: bytes32[];
  // Deposit data
  data: DepositData;
}

export interface VoluntaryExit {
  // Minimum epoch for processing exit
  epoch: Epoch;
  // Index of the exiting validator
  validatorIndex: ValidatorIndex;
  // Validator signature
  signature: BLSSignature;
}

export interface Transfer {
  // Sender index
  sender: ValidatorIndex;
  // Recipient index
  recipient: ValidatorIndex;
  // Amount in Gwei
  amount: Gwei;
  // Fee in Gwei for block proposer
  fee: Gwei;
  // Inclusion slot
  slot: Slot;
  // Sender withdrawal pubkey
  pubkey: BLSPubkey;
  // Sender signature
  signature: BLSSignature;
}
