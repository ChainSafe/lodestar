import {GossipActionError} from "./gossipValidation.js";

export enum AttesterSlashingErrorCode {
  ALREADY_EXISTS = "ATTESTATION_SLASHING_ERROR_ALREADY_EXISTS",
  INVALID = "ATTESTATION_SLASHING_ERROR_INVALID",
  INVALID_SIGNATURE = "ATTESTATION_SLASHING_ERROR_INVALID_SIGNATURE",
}
export type AttesterSlashingErrorType =
  | {code: AttesterSlashingErrorCode.ALREADY_EXISTS}
  | {code: AttesterSlashingErrorCode.INVALID; error: Error}
  | {code: AttesterSlashingErrorCode.INVALID_SIGNATURE};

export class AttesterSlashingError extends GossipActionError<AttesterSlashingErrorType> {}
