/* eslint-disable @typescript-eslint/interface-name-prefix */
/**
 * @module types
 */

import {BitList} from "@chainsafe/bit-utils";

import {
  BLSSignature,
  Epoch,
  ValidatorIndex,
  bytes32,
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
  aggregationBits: BitList;
  // Attestation data
  data: AttestationData;
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
