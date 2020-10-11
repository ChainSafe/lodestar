/* eslint-disable @typescript-eslint/interface-name-prefix */
/**
 * @module types
 */

import {List} from "@chainsafe/ssz";
import {BLSSignature, CommitteeIndex, Epoch, Root, Slot, ValidatorIndex} from "./primitive";
import {Attestation} from "./operations";

export interface CommitteeAssignment {
  validators: List<ValidatorIndex>;
  committeeIndex: CommitteeIndex;
  slot: Slot;
}

export interface AggregateAndProof {
  aggregatorIndex: ValidatorIndex;
  aggregate: Attestation;
  selectionProof: BLSSignature;
}

export interface SignedAggregateAndProof {
  message: AggregateAndProof;
  signature: BLSSignature;
}

/**
 * For validator slashing protection
 */
export interface SlashingProtectionBlock {
  slot: Slot;
  signingRoot: Root;
}

/**
 * For validator slashing protection
 */
export interface SlashingProtectionAttestation {
  sourceEpoch: Epoch;
  targetEpoch: Epoch;
  signingRoot: Root;
}
