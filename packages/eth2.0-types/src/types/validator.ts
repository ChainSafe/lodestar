/* eslint-disable @typescript-eslint/interface-name-prefix */
/**
 * @module types
 */

import {ArrayLike} from "@chainsafe/ssz";

import {BLSPubkey, BLSSignature, CommitteeIndex, Slot, Uint64, ValidatorIndex} from "./primitive";
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
  startingBlock: Uint64;
  // Current Block
  currentBlock: Uint64;
  // The estimated highest block, or current target block number
  highestBlock: Uint64;
}

export interface CommitteeAssignment {
  validators: ArrayLike<ValidatorIndex>;
  committeeIndex: CommitteeIndex;
  slot: Slot;
}

export interface AggregateAndProof {
  aggregatorIndex: ValidatorIndex;
  aggregate: Attestation;
  selectionProof: BLSSignature;
}
