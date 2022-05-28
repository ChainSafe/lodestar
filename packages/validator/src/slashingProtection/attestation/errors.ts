import {Epoch} from "@chainsafe/lodestar-types";
import {LodestarError} from "@chainsafe/lodestar-utils";
import {SlashingProtectionAttestation} from "../types.js";

export enum InvalidAttestationErrorCode {
  /**
   * The attestation has the same target epoch as an attestation from the DB
   */
  DOUBLE_VOTE = "ERR_INVALID_ATTESTATION_DOUBLE_VOTE",
  /**
   * The attestation surrounds an existing attestation from the database `prev`
   */
  NEW_SURROUNDS_PREV = "ERR_INVALID_ATTESTATION_NEW_SURROUNDS_PREV",
  /**
   * The attestation is surrounded by an existing attestation from the database `prev`
   */
  PREV_SURROUNDS_NEW = "ERR_INVALID_ATTESTATION_PREV_SURROUNDS_NEW",
  /**
   * The attestation is invalid because its source epoch is greater than its target epoch
   */
  SOURCE_EXCEEDS_TARGET = "ERR_INVALID_ATTESTATION_SOURCE_EXCEEDS_TARGET",
  /**
   * The attestation is invalid because its source epoch is less than the lower bound on source
   * epochs for this validator.
   */
  SOURCE_LESS_THAN_LOWER_BOUND = "ERR_INVALID_ATTESTATION_SOURCE_LESS_THAN_LOWER_BOUND",
  /**
   * The attestation is invalid because its target epoch is less than or equal to the lower
   * bound on target epochs for this validator.
   */
  TARGET_LESS_THAN_OR_EQ_LOWER_BOUND = "ERR_INVALID_ATTESTATION_TARGET_LESS_THAN_OR_EQ_LOWER_BOUND",
}

type InvalidAttestationErrorType =
  | {
      code: InvalidAttestationErrorCode.DOUBLE_VOTE;
      attestation: SlashingProtectionAttestation;
      prev: SlashingProtectionAttestation;
    }
  | {
      code: InvalidAttestationErrorCode.NEW_SURROUNDS_PREV;
      attestation: SlashingProtectionAttestation;
      // Since using min-max surround, the actual attestation may not be available
      prev: SlashingProtectionAttestation | null;
    }
  | {
      code: InvalidAttestationErrorCode.PREV_SURROUNDS_NEW;
      attestation: SlashingProtectionAttestation;
      // Since using min-max surround, the actual attestation may not be available
      prev: SlashingProtectionAttestation | null;
    }
  | {
      code: InvalidAttestationErrorCode.SOURCE_EXCEEDS_TARGET;
    }
  | {
      code: InvalidAttestationErrorCode.SOURCE_LESS_THAN_LOWER_BOUND;
      sourceEpoch: Epoch;
      minSourceEpoch: Epoch;
    }
  | {
      code: InvalidAttestationErrorCode.TARGET_LESS_THAN_OR_EQ_LOWER_BOUND;
      targetEpoch: Epoch;
      minTargetEpoch: Epoch;
    };

export class InvalidAttestationError extends LodestarError<InvalidAttestationErrorType> {
  constructor(type: InvalidAttestationErrorType) {
    super(type);
  }
}
