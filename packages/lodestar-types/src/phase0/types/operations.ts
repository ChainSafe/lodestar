/**
 * @module types
 */

import {BitList, Vector} from "@chainsafe/ssz";

import {BLSSignature, Bytes32, Epoch, ValidatorIndex} from "../../primitive/types";

import {AttestationData, SignedBeaconBlockHeader, DepositData, IndexedAttestation} from "./misc";

export interface ProposerSlashing {
  // First block header
  signedHeader1: SignedBeaconBlockHeader;
  // Second block header
  signedHeader2: SignedBeaconBlockHeader;
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
  proof: Vector<Bytes32>;
  // Deposit data
  data: DepositData;
}

export interface VoluntaryExit {
  // Minimum epoch for processing exit
  epoch: Epoch;
  // Index of the exiting validator
  validatorIndex: ValidatorIndex;
}

export interface SignedVoluntaryExit {
  message: VoluntaryExit;
  // Validator signature
  signature: BLSSignature;
}
