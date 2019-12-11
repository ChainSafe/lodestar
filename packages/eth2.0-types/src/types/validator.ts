/* eslint-disable @typescript-eslint/interface-name-prefix */
/**
 * @module types
 */

import {BLSPubkey, BLSSignature, CommitteeIndex, Slot, uint64, ValidatorIndex} from "./primitive";
import {Attestation} from "./operations";

export interface ValidatorDuty {
  // The validator's public key, uniquely identifying them
  validatorPubkey: BLSPubkey;
  // The slot at which the validator must attest
  attestationSlot: Slot;

  committeeIndex: CommitteeIndex;
}

export interface SyncingStatus {
  // The block at which syncing started (will only be reset, after the sync reached his head)
  startingBlock: uint64;
  // Current Block
  currentBlock: uint64;
  // The estimated highest block, or current target block number
  highestBlock: uint64;
}

export interface CommitteeAssignment {
  validators: ValidatorIndex[];
  committeeIndex: CommitteeIndex;
  slot: Slot;
}

export interface AggregateAndProof {
  index: ValidatorIndex;
  selectionProof: BLSSignature;
  aggregate: Attestation;
}