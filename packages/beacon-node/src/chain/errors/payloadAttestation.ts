import {RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import {GossipActionError} from "./gossipValidation.ts";

export enum PayloadAttestationErrorCode {
  NOT_CURRENT_SLOT = "PAYLOAD_ATTESTATION_ERROR_NOT_CURRENT_SLOT",
  PAYLOAD_ATTESTATION_ALREADY_KNOWN = "PAYLOAD_ATTESTATION_ERROR_PAYLOAD_ATTESTATION_ALREADY_KNOWN",
  UNKNOWN_BLOCK_ROOT = "PAYLOAD_ATTESTATION_ERROR_UNKNOWN_BLOCK_ROOT",
  INVALID_BLOCK = "PAYLOAD_ATTESTATION_ERROR_INVALID_BLOCK",
  INVALID_ATTESTER = "PAYLOAD_ATTESTATION_ERROR_INVALID_ATTESTER",
  INVALID_SIGNATURE = "PAYLOAD_ATTESTATION_ERROR_INVALID_SIGNATURE",
}
export type PayloadAttestationErrorType =
  | {code: PayloadAttestationErrorCode.NOT_CURRENT_SLOT; currentSlot: Slot; slot: Slot}
  | {
      code: PayloadAttestationErrorCode.PAYLOAD_ATTESTATION_ALREADY_KNOWN;
      validatorIndex: ValidatorIndex;
      slot: Slot;
      blockRoot: RootHex;
    }
  | {code: PayloadAttestationErrorCode.UNKNOWN_BLOCK_ROOT; blockRoot: RootHex}
  | {code: PayloadAttestationErrorCode.INVALID_BLOCK; blockRoot: RootHex}
  | {code: PayloadAttestationErrorCode.INVALID_ATTESTER; attesterIndex: ValidatorIndex}
  | {code: PayloadAttestationErrorCode.INVALID_SIGNATURE};

export class PayloadAttestationError extends GossipActionError<PayloadAttestationErrorType> {}
